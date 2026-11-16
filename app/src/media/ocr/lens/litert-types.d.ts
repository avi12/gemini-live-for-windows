// The part of LiteRT.js this app uses. The package's own typings widen every typed array's constructor
// globally, which breaks the rest of the app's types, so tsconfig points `@litertjs/core` here instead.
// The runtime still loads the real package.
export interface Tensor {
  readonly type: {
    readonly layout: {
      readonly dimensions: readonly number[];
    };
  };
  toTypedArray(): ArrayLike<number | bigint>;
  delete(): void;
}

export const Tensor: new (data: Uint8Array, shape: readonly number[]) => Tensor;

export interface CompiledModel {
  run(input: Tensor): Promise<Tensor[]>;
}

export const loadLiteRt: (wasmDirectoryUrl: string, options: object) => Promise<void>;

export const loadAndCompile: (
  model: Uint8Array,
  options: {
    accelerator: "wasm";
  }
) => Promise<CompiledModel>;
