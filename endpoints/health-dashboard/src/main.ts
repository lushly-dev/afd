/** Entry point: register FAST-AF components, apply the theme, then load `?report=` paths. */
import '@lushly-dev/violet-elements';
import { defineHealthDashboard, type HealthDashboard } from './app/health-dashboard';
import { registerStatusIcons } from './app/icons';
import { applyTheme } from './app/theme';
import { reportRequests } from './report/url';
import './styles.css';

applyTheme();
registerStatusIcons();
await defineHealthDashboard();
const app = document.querySelector<HealthDashboard>('health-dashboard');
await app?.loadRequests(reportRequests(location.search, location.href));
document.documentElement.dataset.ready = 'true';
