use std::sync::Mutex;
use crate::flipper::client::FlipperClient;

pub struct AppState {
    pub client: Mutex<Option<FlipperClient>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }
}
