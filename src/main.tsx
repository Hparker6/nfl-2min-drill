import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from './game/analytics';
import './styles.css';

initAnalytics();
createRoot(document.getElementById('root')!).render(<App />);
