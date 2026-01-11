import { useState, useCallback } from "react";

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  warning?: string;
  resolve?: (value: boolean) => void;
}

export const useConfirm = () => {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    title: "",
    message: "",
  });

  const confirm = useCallback(
    (title: string, message: string, warning?: string): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({ isOpen: true, title, message, warning, resolve });
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState((s) => ({ ...s, isOpen: false }));
  }, [state]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState((s) => ({ ...s, isOpen: false }));
  }, [state]);

  return { state, confirm, handleConfirm, handleCancel };
};
