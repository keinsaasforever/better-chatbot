import { useMemo, useState } from "react";

export const useObjectState = <T extends Record<string, any>>(
  initialState: T,
) => {
  const [state, setState] = useState<T>(initialState);

  const dispatch = useMemo(() => {
    return (value: Mutate<T>) => {
      setState((prev) => {
        const newState = typeof value === "function" ? value(prev) : value;
        return { ...prev, ...newState };
      });
    };
  }, []);

  return [state, dispatch] as const;
};
