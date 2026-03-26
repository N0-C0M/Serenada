import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import CallRoom from './pages/CallRoom';
import OverlayCall from './pages/OverlayCall';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/call/:roomId" element={<CallRoom />} />
        <Route path="/overlay" element={<OverlayCall />} />
      </Routes>
    </Router>
  );
}

export default App;
