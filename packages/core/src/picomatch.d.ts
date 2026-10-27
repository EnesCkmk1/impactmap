declare module "picomatch" {
  interface Options {
    dot?: boolean;
  }

  type Matcher = (input: string) => boolean;

  interface Picomatch {
    (pattern: string, options?: Options): Matcher;
    isMatch: (
      input: string,
      pattern: string | string[],
      options?: Options,
    ) => boolean;
  }

  const picomatch: Picomatch;
  export default picomatch;
}
