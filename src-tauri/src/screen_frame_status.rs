//! Read the numeric status attachment without the pinned wrapper's NSNumber →
//! Swift-enum cast (which returns None for valid screen frames).
use screencapturekit::cm::{CMSampleBuffer, SCFrameStatus};
use std::ffi::c_void;

#[link(name = "CoreMedia", kind = "framework")]
unsafe extern "C" {
    fn CMSampleBufferGetSampleAttachmentsArray(sample: *mut c_void, create: bool) -> *const c_void;
}
#[link(name = "ScreenCaptureKit", kind = "framework")]
unsafe extern "C" {
    static SCStreamFrameInfoStatus: *const c_void;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFDictionaryGetValue(dictionary: *const c_void, key: *const c_void) -> *const c_void;
    fn CFGetTypeID(value: *const c_void) -> usize;
    fn CFNumberGetTypeID() -> usize;
    fn CFNumberGetValue(number: *const c_void, kind: isize, value: *mut c_void) -> bool;
}

pub fn frame_status(sample: &CMSampleBuffer) -> Option<SCFrameStatus> {
    // All attachment references are borrowed and remain valid for this sample.
    unsafe {
        attachment_status(CMSampleBufferGetSampleAttachmentsArray(
            sample.as_ptr(),
            false,
        ))
    }
}

unsafe fn attachment_status(array: *const c_void) -> Option<SCFrameStatus> {
    unsafe {
        if array.is_null() || CFArrayGetCount(array) == 0 {
            return None;
        }
        let dictionary = CFArrayGetValueAtIndex(array, 0);
        if dictionary.is_null() {
            return None;
        }
        let number = CFDictionaryGetValue(dictionary, SCStreamFrameInfoStatus);
        if number.is_null() || CFGetTypeID(number) != CFNumberGetTypeID() {
            return None;
        }
        let mut raw: i64 = -1;
        // kCFNumberSInt64Type = 4. Apple stores SCStreamFrameInfo.status as NSNumber.
        if !CFNumberGetValue(number, 4, (&mut raw as *mut i64).cast()) {
            return None;
        }
        i32::try_from(raw).ok().and_then(SCFrameStatus::from_raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    unsafe extern "C" {
        fn CFNumberCreate(
            allocator: *const c_void,
            kind: isize,
            value: *const c_void,
        ) -> *const c_void;
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            count: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFArrayCreate(
            allocator: *const c_void,
            values: *const *const c_void,
            count: isize,
            callbacks: *const c_void,
        ) -> *const c_void;
        fn CFRelease(value: *const c_void);
    }
    #[test]
    fn reads_real_cfnumber_status_attachments_including_complete_and_idle() {
        unsafe {
            for raw in [0i64, 1, 2, 3, 4, 5, 99] {
                let nil = std::ptr::null();
                let number = CFNumberCreate(nil, 4, (&raw as *const i64).cast());
                let dictionary =
                    CFDictionaryCreate(nil, &SCStreamFrameInfoStatus, &number, 1, nil, nil);
                let array = CFArrayCreate(nil, &dictionary, 1, nil);
                assert_eq!(
                    attachment_status(array),
                    SCFrameStatus::from_raw(raw as i32)
                );
                CFRelease(array);
                CFRelease(dictionary);
                CFRelease(number);
            }
            assert_eq!(attachment_status(std::ptr::null()), None);
        }
    }
}
