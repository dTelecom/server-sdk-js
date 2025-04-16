declare module 'ip-to-int' {
  function ipToInt(ip: string): { toInt: () => number; toIP: () => string };
  export = ipToInt;
} 