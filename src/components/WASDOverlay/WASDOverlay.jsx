import React, { useState, useEffect, useRef } from 'react';
import './WASDOverlay.css';

const WASDOverlay = ({ pressedKeys }) => {
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (pressedKeys.size > 0) {
      setIsVisible(true);
      if (timerRef.current) clearTimeout(timerRef.current);
    } else {
      // Start timer to hide after 1s
      timerRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pressedKeys]);

  const keys = [
    { label: 'W', id: 'w', gridArea: '1 / 2' },
    { label: 'A', id: 'a', gridArea: '2 / 1' },
    { label: 'S', id: 's', gridArea: '2 / 2' },
    { label: 'D', id: 'd', gridArea: '2 / 3' }
  ];

  return (
    <div className={`wasd-overlay-container ${isVisible ? 'visible' : ''}`}>
      <div className="wasd-grid">
        {keys.map(key => (
          <div
            key={key.id}
            className={`wasd-key ${pressedKeys.has(key.id) ? 'pressed' : ''}`}
            style={{ gridArea: key.gridArea }}
          >
            {key.label}
          </div>
        ))}
      </div>
    </div>
  );
};


export default WASDOverlay;
