use crossbeam_channel::Receiver;

use crate::screen::{ScreenCaptureConfig, ScreenFrame};

pub trait ScreenCaptureBackend: Send + Sync {
    fn new(config: ScreenCaptureConfig) -> Result<Self, String>
    where
        Self: Sized;
    fn dimensions(&self) -> (u32, u32);
    fn take_receiver(&mut self) -> Option<Receiver<ScreenFrame>>;
    fn start(&self) -> Result<(), String>;
    fn stop(&self);
    fn is_running(&self) -> bool;
}
