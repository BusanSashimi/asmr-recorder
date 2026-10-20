#!/usr/bin/env python3
"""Exercise the resolved ScreenCaptureKit dependency's real Rust callback.

No screen permission is needed: only the CoreMedia sample allocation is replaced
by a reference-counted marker. Registry/context types and sample_handler itself
are compiled verbatim from Cargo's resolved source, so this catches cross-stream
delivery in the dependency rather than retesting our frontend mocks.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CARGO = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo")
RUSTC = shutil.which("rustc") or str(Path.home() / ".cargo/bin/rustc")


def item(source, marker):
    start = source.index(marker)
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


host = next(line.removeprefix("host: ") for line in subprocess.check_output(
    [RUSTC, "-vV"], text=True,
).splitlines() if line.startswith("host: "))
metadata = json.loads(subprocess.check_output(
    [CARGO, "metadata", "--locked", "--offline", "--filter-platform", host, "--format-version", "1"],
    cwd=ROOT / "src-tauri", text=True,
))
package = next(p for p in metadata["packages"] if p["name"] == "screencapturekit")
source = (Path(package["manifest_path"]).parent / "src/stream/sc_stream.rs").read_text()
parts = [item(source, "struct HandlerEntry")]
if "struct StreamContext" in source:
    parts += [item(source, "struct StreamContext"), item(source, "impl StreamContext")]
    setup = """
    let contexts: Vec<_> = (0..4).map(|index| {
        let context = StreamContext::new();
        let received = received[index].clone();
        unsafe { &*context }.handlers.lock().unwrap().push(HandlerEntry {
            id: index, of_type: SCStreamOutputType::Screen,
            handler: Box::new(move |sample: cm::CMSampleBuffer, _| {
                received.lock().unwrap().push(sample.marker());
            }),
        });
        context
    }).collect();
    for (index, context) in contexts.iter().enumerate() {
        sample_handler((*context).cast(), cm::sample(index), 0);
    }
    for context in contexts { unsafe { StreamContext::release(context) }; }
    """
else:
    # 1.5.0's production callback ignores its stream argument and broadcasts to
    # this registry. The same four-source assertion below must fail on it.
    parts.append("static HANDLER_REGISTRY: Mutex<Option<HashMap<usize, HandlerEntry>>> = Mutex::new(None);")
    setup = """
    let handlers = (0..4).map(|index| {
        let received = received[index].clone();
        (index, HandlerEntry { ref_count: 1, handler: Box::new(move |sample: cm::CMSampleBuffer, _| {
            received.lock().unwrap().push(sample.marker());
        }) })
    }).collect();
    *HANDLER_REGISTRY.lock().unwrap() = Some(handlers);
    for index in 0..4 { sample_handler((index + 1) as *const c_void, cm::sample(index), 0); }
    *HANDLER_REGISTRY.lock().unwrap() = None;
    """
parts.append(item(source, 'extern "C" fn sample_handler'))
stubs = r"""
#![allow(dead_code, unused_imports)]
use std::{collections::HashMap, ffi::c_void, sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}}};
#[derive(Clone, Copy, PartialEq, Eq)] enum SCStreamOutputType { Screen, Audio, Microphone }
trait SCStreamDelegateTrait: Send + Sync {}
trait SCStreamOutputTrait: Send + Sync {
    fn did_output_sample_buffer(&self, sample: cm::CMSampleBuffer, output: SCStreamOutputType);
}
impl<F: Fn(cm::CMSampleBuffer, SCStreamOutputType) + Send + Sync> SCStreamOutputTrait for F {
    fn did_output_sample_buffer(&self, sample: cm::CMSampleBuffer, output: SCStreamOutputType) { self(sample, output); }
}
mod cm {
    use super::*;
    static LIVE: AtomicUsize = AtomicUsize::new(0);
    struct Sample { marker: usize, refs: AtomicUsize }
    pub struct CMSampleBuffer(*mut c_void);
    impl CMSampleBuffer {
        pub unsafe fn from_ptr(pointer: *mut c_void) -> Self { Self(pointer) }
        pub fn marker(&self) -> usize { unsafe { &*self.0.cast::<Sample>() }.marker }
    }
    impl Drop for CMSampleBuffer { fn drop(&mut self) { unsafe { ffi::cm_sample_buffer_release(self.0) }; } }
    pub fn sample(marker: usize) -> *const c_void {
        LIVE.fetch_add(1, Ordering::Relaxed);
        Box::into_raw(Box::new(Sample { marker, refs: AtomicUsize::new(1) })).cast()
    }
    pub fn live() -> usize { LIVE.load(Ordering::Relaxed) }
    pub mod ffi {
        use super::*;
        pub unsafe fn cm_sample_buffer_retain(pointer: *mut c_void) {
            unsafe { &*pointer.cast::<Sample>() }.refs.fetch_add(1, Ordering::Relaxed);
        }
        pub unsafe fn cm_sample_buffer_release(pointer: *mut c_void) {
            if unsafe { &*pointer.cast::<Sample>() }.refs.fetch_sub(1, Ordering::Relaxed) == 1 {
                drop(unsafe { Box::from_raw(pointer.cast::<Sample>()) });
                LIVE.fetch_sub(1, Ordering::Relaxed);
            }
        }
    }
}
"""
assertions = """
    assert_eq!(cm::live(), 0, "sample references leaked");
    for (index, received) in received.iter().enumerate() {
        let actual = received.lock().unwrap();
        println!("cell {}: frame sources {:?}; expected [{}]", index + 1, *actual, index);
        assert_eq!(*actual, vec![index], "a cell received another screen's frame");
    }
    println!("PASS: four concurrent screen callbacks stay isolated; sample ownership balanced");
}
"""
program = stubs + "\n".join(parts) + "\nfn main() {\n" + (
    "let received: Vec<_> = (0..4).map(|_| Arc::new(Mutex::new(Vec::<usize>::new()))).collect();\n"
) + setup + assertions
print(f"Checking screencapturekit {package['version']} native callback routing", flush=True)
with tempfile.TemporaryDirectory(prefix="asmr-screen-routing-") as directory:
    path = Path(directory)
    (path / "check.rs").write_text(program)
    subprocess.run([RUSTC, "--edition=2024", str(path / "check.rs"), "-o", str(path / "check")], check=True)
    result = subprocess.run([str(path / "check")])
    raise SystemExit(result.returncode)
