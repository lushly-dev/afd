import { useCallback, useState } from 'react';

interface ConfirmOptions {
	title: string;
	message: string;
	warning?: string;
	confirmText?: string;
	cancelText?: string;
}

interface ConfirmState {
	isOpen: boolean;
	title: string;
	message: string;
	warning?: string;
	confirmText?: string;
	cancelText?: string;
	resolve?: (value: boolean) => void;
}

export const useConfirm = () => {
	const [state, setState] = useState<ConfirmState>({
		isOpen: false,
		title: '',
		message: '',
	});

	const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
		return new Promise((resolve) => {
			setState({
				isOpen: true,
				title: options.title,
				message: options.message,
				warning: options.warning,
				confirmText: options.confirmText,
				cancelText: options.cancelText,
				resolve,
			});
		});
	}, []);

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
