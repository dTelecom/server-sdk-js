declare module 'protobufjs/minimal' {
  import protobuf from 'protobufjs';
  export import Reader = protobuf.Reader;
  export import Writer = protobuf.Writer;
  export import util = protobuf.util;
  export import roots = protobuf.roots;
  export const configure: typeof protobuf.configure;
  const _default: {
    Reader: typeof protobuf.Reader;
    Writer: typeof protobuf.Writer;
    util: typeof protobuf.util;
    roots: typeof protobuf.roots;
    configure: typeof protobuf.configure;
  };
  export default _default;
}
