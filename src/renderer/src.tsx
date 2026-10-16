import { createRoot } from 'react-dom/client';
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<App />);
