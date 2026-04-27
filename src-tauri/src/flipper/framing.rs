use prost::Message;

use crate::error::{FlipperError, Result};
use crate::flipper::diag;
use crate::flipper::transport::Transport;
use crate::pb;
use crate::pb::main::Content;

/// Read a protobuf-style varint from the transport.
///
/// Returns a u32 message length. Errors if the decoded value exceeds u32::MAX
/// (which would mean a >4 GB message — clearly corrupt framing).
///
/// Transactional: if reading times out (or hits another I/O error) mid-varint,
/// the bytes already consumed are pushed back via `Transport::unread` so the
/// next call can resume cleanly. Without this, a screen-stream reader using a
/// short timeout will pop a varint byte, time out on the next, drop the byte,
/// and desync framing — surfacing as "Protobuf decode error: invalid tag".
pub fn read_varint(t: &mut dyn Transport) -> Result<u32> {
    let mut result: u64 = 0;
    let mut shift = 0u32;
    let mut byte = [0u8; 1];
    let mut consumed: [u8; 5] = [0; 5];
    let mut consumed_len = 0usize;
    loop {
        if let Err(e) = t.read_exact(&mut byte) {
            if consumed_len > 0 {
                t.unread(&consumed[..consumed_len]);
            }
            return Err(e.into());
        }
        if consumed_len < consumed.len() {
            consumed[consumed_len] = byte[0];
            consumed_len += 1;
        }
        let b = byte[0] as u64;
        result |= (b & 0x7F) << shift;
        if b & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 35 {
            // A u32 needs at most 5 varint bytes (35 bits). Anything larger
            // is either a corrupt stream or a >4 GB value we can't handle.
            return Err(FlipperError::Decode(prost::DecodeError::new(
                "varint overflow",
            )));
        }
    }
    if result > u32::MAX as u64 {
        return Err(FlipperError::Decode(prost::DecodeError::new(
            "message length exceeds u32::MAX",
        )));
    }
    Ok(result as u32)
}

/// Encode a u64 as a varint into `buf`. Returns the number of bytes written.
fn encode_varint(mut value: u64, buf: &mut [u8; 10]) -> usize {
    let mut i = 0;
    loop {
        let byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            buf[i] = byte | 0x80;
        } else {
            buf[i] = byte;
            i += 1;
            break;
        }
        i += 1;
    }
    i
}

/// Read one complete `PB.Main` message from the transport.
///
/// Transactional: on a mid-frame timeout while reading the body, the varint
/// length prefix is re-encoded and pushed back via `Transport::unread` so the
/// next call resumes from the same frame boundary. (`SerialTransport` /
/// `BleTransport` already push back any partial body bytes on their side.)
pub fn read_message(t: &mut dyn Transport) -> Result<pb::Main> {
    let len = read_varint(t)?;
    let mut buf = vec![0u8; len as usize];
    if let Err(e) = t.read_exact(&mut buf) {
        let mut varint_buf = [0u8; 10];
        let n = encode_varint(len as u64, &mut varint_buf);
        t.unread(&varint_buf[..n]);
        return Err(e.into());
    }
    let msg = pb::Main::decode(buf.as_slice())?;
    diag::log(diag::Direction::Rx, &msg, len as usize);
    Ok(msg)
}

/// Read the next RPC response, silently discarding any unsolicited screen-stream
/// frames that may be sitting in the rx buffer.
///
/// This exists because BLE (and to a lesser extent USB) shares one transport
/// between the screen-stream reader and any other RPC command. While
/// `screen_stream_start` is active, the firmware emits `GuiScreenFrame` messages
/// continuously; if a periodic command (ping, power_info, …) writes its
/// request and then calls `read_message`, the next bytes off the wire are
/// frequently a screen frame the reader thread didn't get to first. Treating
/// that frame as a "wrong command_id" response made `with_client` tear down the
/// session and silently kill the screen reader. Skipping the frame here keeps
/// both consumers happy at the cost of dropping a single frame per racing call.
///
/// This is the helper every RPC command path should use; the screen reader
/// itself keeps calling `read_message` directly because it actually wants
/// frames.
pub fn read_response(t: &mut dyn Transport) -> Result<pb::Main> {
    loop {
        let msg = read_message(t)?;
        if matches!(msg.content, Some(Content::GuiScreenFrame(_))) {
            continue;
        }
        return Ok(msg);
    }
}

/// Write one `PB.Main` message to the transport with a varint length prefix.
pub fn write_message(t: &mut dyn Transport, msg: &pb::Main) -> Result<()> {
    let encoded = msg.encode_to_vec();
    let mut varint_buf = [0u8; 10];
    let varint_len = encode_varint(encoded.len() as u64, &mut varint_buf);
    t.write_all(&varint_buf[..varint_len])?;
    t.write_all(&encoded)?;
    t.flush()?;
    diag::log(diag::Direction::Tx, msg, encoded.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_roundtrip() {
        let cases: &[u32] = &[0, 1, 127, 128, 255, 300, 16383, 16384, 65535, u32::MAX];
        for &v in cases {
            let mut buf = [0u8; 10];
            let len = encode_varint(v as u64, &mut buf);
            // Decode using a cursor
            let mut cursor = std::io::Cursor::new(&buf[..len]);
            let mut result: u64 = 0;
            let mut shift = 0u32;
            loop {
                let mut b = [0u8; 1];
                std::io::Read::read_exact(&mut cursor, &mut b).unwrap();
                let byte = b[0] as u64;
                result |= (byte & 0x7F) << shift;
                if byte & 0x80 == 0 {
                    break;
                }
                shift += 7;
            }
            assert_eq!(result as u32, v, "varint roundtrip failed for {v}");
        }
    }

    /// Test transport that hands out queued chunks of bytes. Each `read_exact`
    /// pops from the next chunk; if the chunk has fewer bytes than requested,
    /// it returns TimedOut to simulate a mid-frame BLE timeout.
    struct ChunkedTransport {
        chunks: std::collections::VecDeque<Vec<u8>>,
        pushback: std::collections::VecDeque<u8>,
    }

    impl ChunkedTransport {
        fn new(chunks: Vec<Vec<u8>>) -> Self {
            Self {
                chunks: chunks.into(),
                pushback: std::collections::VecDeque::new(),
            }
        }
    }

    impl crate::flipper::transport::Transport for ChunkedTransport {
        fn read_exact(&mut self, buf: &mut [u8]) -> std::io::Result<()> {
            let mut filled = 0;
            while filled < buf.len() && !self.pushback.is_empty() {
                buf[filled] = self.pushback.pop_front().unwrap();
                filled += 1;
            }
            if filled == buf.len() {
                return Ok(());
            }
            let Some(chunk) = self.chunks.pop_front() else {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "no more chunks",
                ));
            };
            let need = buf.len() - filled;
            if chunk.len() < need {
                // Simulate mid-frame timeout: caller's read_exact partially
                // satisfied. We push the chunk into pushback so it survives,
                // mirroring how real BleTransport keeps unconsumed bytes.
                self.pushback.extend(chunk);
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "chunk underflow",
                ));
            }
            buf[filled..].copy_from_slice(&chunk[..need]);
            // Any extra in this chunk beyond `need` is leftover available to
            // the next read.
            for &b in &chunk[need..] {
                self.pushback.push_back(b);
            }
            Ok(())
        }
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            unimplemented!()
        }
        fn write_all(&mut self, _buf: &[u8]) -> std::io::Result<()> {
            unimplemented!()
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn set_timeout(&mut self, _dur: std::time::Duration) -> std::io::Result<()> {
            Ok(())
        }
        fn unread(&mut self, bytes: &[u8]) {
            for b in bytes.iter().rev() {
                self.pushback.push_front(*b);
            }
        }
        fn kind(&self) -> crate::flipper::transport::TransportKind {
            crate::flipper::transport::TransportKind::Ble
        }
    }

    #[test]
    fn read_message_recovers_after_mid_varint_timeout() {
        // Encode a real message and split its bytes into pathological chunks
        // that strand the reader mid-varint and mid-body. Two failed attempts
        // followed by a successful one must decode to the original message.
        let msg = pb::Main {
            command_id: 7,
            command_status: 0,
            has_next: false,
            content: None,
        };
        let encoded = msg.encode_to_vec();
        let mut framed = Vec::new();
        let mut varint_buf = [0u8; 10];
        let n = encode_varint(encoded.len() as u64, &mut varint_buf);
        framed.extend_from_slice(&varint_buf[..n]);
        framed.extend_from_slice(&encoded);

        // Single-byte chunks force the body read to underflow on the first
        // attempt: varint succeeds, body pop sees only 1 of N bytes and times
        // out. Without rollback, the varint and partial body byte would be
        // lost; with it, the second attempt can resume and decode cleanly.
        assert!(framed.len() >= 3, "framed too short to test");
        let chunks: Vec<Vec<u8>> = framed.iter().map(|b| vec![*b]).collect();
        let mut t = ChunkedTransport::new(chunks);

        let r1 = read_message(&mut t);
        assert!(r1.is_err(), "first call should time out");
        let decoded = read_message(&mut t).expect("second call should succeed");
        assert_eq!(decoded.command_id, 7);
    }

    #[test]
    fn message_roundtrip() {
        let msg = pb::Main {
            command_id: 42,
            command_status: 0,
            has_next: false,
            content: None,
        };
        let encoded = msg.encode_to_vec();
        let decoded = pb::Main::decode(encoded.as_slice()).unwrap();
        assert_eq!(decoded.command_id, 42);
        assert!(!decoded.has_next);
    }
}
