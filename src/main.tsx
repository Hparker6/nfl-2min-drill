import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from './game/analytics';
import { captureChallenge } from './game/challenge';
import './styles.css';

captureChallenge();   // a ?c= challenge link: kept for the Daily, then taken out of the address
initAnalytics();
createRoot(document.getElementById('root')!).render(<App />);
