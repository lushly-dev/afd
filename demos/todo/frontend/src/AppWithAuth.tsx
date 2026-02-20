import { useAuthToken } from '@convex-dev/auth/react';
import type React from 'react';
import App from './App';
import { Login } from './components/Login';

export const AppWithAuth: React.FC = () => {
	const token = useAuthToken();
	const isLoading = token === undefined;
	const isAuthenticated = token !== null;

	if (isLoading) {
		return (
			<div className="loading-container">
				<div className="loading-spinner">Loading...</div>
			</div>
		);
	}

	if (!isAuthenticated) {
		return <Login />;
	}

	return <App />;
};
