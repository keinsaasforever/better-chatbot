export default function equal(a: any, b: any): boolean {
  if (a === b) return true;

  if (a && b && typeof a === "object" && typeof b === "object") {
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

    // Handle Array
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!equal(a[i], b[i])) return false;
      }
      return true;
    }

    // Handle Date
    if (a instanceof Date)
      return b instanceof Date && a.getTime() === b.getTime();

    // Handle RegExp
    if (a instanceof RegExp)
      return (
        b instanceof RegExp && a.source === b.source && a.flags === b.flags
      );

    // Handle Map
    if (a instanceof Map) {
      if (!(b instanceof Map) || a.size !== b.size) return false;
      for (const [key, val] of a) {
        if (!b.has(key) || !equal(val, b.get(key))) return false;
      }
      return true;
    }

    // Handle Set
    if (a instanceof Set) {
      if (!(b instanceof Set) || a.size !== b.size) return false;
      for (const val of a) {
        if (!b.has(val)) return false;
      }
      return true;
    }

    // Handle general object
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!equal(a[key], b[key])) return false;
    }

    return true;
  }

  // Handle NaN
  return Number.isNaN(a) && Number.isNaN(b);
}
