// A silent input block still occupies real capture time. Sending every render
// quantum prevents inactive inputs from shortening the encoded audio timeline.
export const ENCODE_WORKLET_CODE = `
class EncodeSourceProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const length = output[0]?.length || input[0]?.length || 128;
    const channels = Array.from({length: output.length || 2}, (_, index) =>
      (input[index] || input[0] || new Float32Array(length)).slice()
    );
    this.port.postMessage({channels, time: currentTime});
    return true;
  }
}
registerProcessor('encode-source', EncodeSourceProcessor);
`;
