import { isFunction, nextTick } from "lib/utils";
import { useCallback, useState } from "react";

export function useUpdate() {
  const [, setState] = useState(0);

  const update = useCallback((cb?: () => void) => {
    nextTick().then(() => {
      setState((prev) => prev + 1);
      if (isFunction(cb)) {
        cb();
      }
    });
  }, []);

  return update;
}
