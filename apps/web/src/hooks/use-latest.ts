import { useRef } from "react";

export const useToRef = <T>(value: T) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};
