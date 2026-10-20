//! One pending frame; capture callbacks never wait for the consumer.
use crossbeam_channel::{RecvTimeoutError, TryRecvError};
use parking_lot::{Condvar, Mutex};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub struct LatestFrame<T>(Arc<Inner<T>>);
struct Inner<T> {
    slot: Mutex<Slot<T>>,
    available: Condvar,
}
struct Slot<T> {
    frame: Option<T>,
    closed: bool,
}
impl<T> Clone for LatestFrame<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}
impl<T> Default for LatestFrame<T> {
    fn default() -> Self {
        Self(Arc::new(Inner {
            slot: Mutex::new(Slot {
                frame: None,
                closed: false,
            }),
            available: Condvar::new(),
        }))
    }
}
impl<T> LatestFrame<T> {
    /// Construct/copy only after acquiring the slot without waiting. No native
    /// pixel buffer is retained after this call. Replaced frames are freed here.
    pub fn publish_with(&self, make: impl FnOnce() -> T) -> bool {
        let Some(mut slot) = self.0.slot.try_lock() else {
            return false;
        };
        if slot.closed {
            return false;
        }
        slot.frame = Some(make());
        self.0.available.notify_one();
        true
    }
    pub fn recv_timeout(&self, timeout: Duration) -> Result<T, RecvTimeoutError> {
        let deadline = Instant::now() + timeout;
        let mut slot = self.0.slot.lock();
        loop {
            if slot.closed {
                return Err(RecvTimeoutError::Disconnected);
            }
            if let Some(frame) = slot.frame.take() {
                return Ok(frame);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(RecvTimeoutError::Timeout);
            }
            self.0.available.wait_for(&mut slot, remaining);
        }
    }
    pub fn try_recv(&self) -> Result<T, TryRecvError> {
        let mut slot = self.0.slot.lock();
        if slot.closed {
            return Err(TryRecvError::Disconnected);
        }
        slot.frame.take().ok_or(TryRecvError::Empty)
    }
    pub fn close(&self) {
        let mut slot = self.0.slot.lock();
        slot.closed = true;
        slot.frame = None;
        self.0.available.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[test]
    fn fast_producer_retains_only_newest_and_releases_replaced_frames() {
        struct Frame(usize, Arc<AtomicUsize>);
        impl Drop for Frame {
            fn drop(&mut self) {
                self.1.fetch_add(1, Ordering::Relaxed);
            }
        }
        let dropped = Arc::new(AtomicUsize::new(0));
        let buffer = LatestFrame::default();
        for i in 0..100 {
            assert!(buffer.publish_with(|| Frame(i, dropped.clone())));
        }
        assert_eq!(dropped.load(Ordering::Relaxed), 99);
        assert_eq!(buffer.try_recv().unwrap().0, 99);
        assert_eq!(dropped.load(Ordering::Relaxed), 100);
    }
    #[test]
    fn busy_or_closed_buffer_never_copies_and_close_wakes_consumer() {
        let buffer = LatestFrame::<u32>::default();
        let held = buffer.0.slot.lock();
        assert!(!buffer.publish_with(|| panic!("must not copy while busy")));
        drop(held);
        let consumer = buffer.clone();
        let started = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.0.send(()).unwrap();
            consumer.recv_timeout(Duration::from_secs(10))
        });
        started.1.recv().unwrap();
        buffer.close();
        assert_eq!(worker.join().unwrap(), Err(RecvTimeoutError::Disconnected));
        assert!(!buffer.publish_with(|| panic!("must not copy after close")));
    }
}
