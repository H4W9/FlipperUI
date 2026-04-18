use prost::Message;
use serialport::SerialPort;
use crate::error::{FlipperError, Result};
use crate::flipper::diag;
use crate::pb;

/// Read a protobuf-style varint from the serial port.
///
/// Returns a u32 message length. Errors if the decoded value exceeds u32::MAX
/// (which would mean a >4 GB message — clearly corrupt framing).
pub fn read_varint(port: &mut dyn SerialPort) -> Result<u32> {
    let mut result: u64 = 0;
    let mut shift = 0u32;
    let mut byte = [0u8; 1];
    loop {
        port.read_exact(&mut byte)?;
        let b = byte[0] as u64;
        result |= (b & 0x7F) << shift;
        if b & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 35 {
            // A u32 needs at most 5 varint bytes (35 bits). Anything larger
            // is either a corrupt stream or a >4 GB value we can't handle.
            return Err(FlipperError::Decode(prost::DecodeError::new("varint overflow")));
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

/// Read one complete `PB.Main` message from the serial port.
pub fn read_message(port: &mut dyn SerialPort) -> Result<pb::Main> {
    let len = read_varint(port)?;
    let mut buf = vec![0u8; len as usize];
    port.read_exact(&mut buf)?;
    let msg = pb::Main::decode(buf.as_slice())?;
    diag::log(diag::Direction::Rx, &msg, len as usize);
    Ok(msg)
}

/// Write one `PB.Main` message to the serial port with a varint length prefix.
pub fn write_message(port: &mut dyn SerialPort, msg: &pb::Main) -> Result<()> {
    let encoded = msg.encode_to_vec();
    let mut varint_buf = [0u8; 10];
    let varint_len = encode_varint(encoded.len() as u64, &mut varint_buf);
    port.write_all(&varint_buf[..varint_len])?;
    port.write_all(&encoded)?;
    port.flush()?;
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
                if byte & 0x80 == 0 { break; }
                shift += 7;
            }
            assert_eq!(result as u32, v, "varint roundtrip failed for {v}");
        }
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
