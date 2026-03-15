// src/utils/consoleInterceptor.js
const logBuffer = [];
const MAX_LOGS = 200; // Prevent memory bloat

export const initLogInterceptor = () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const safeStringify = (arg) => {
    if (typeof arg !== 'object' || arg === null) return String(arg);
    try {
      // Avoid circular references or massive objects
      return JSON.stringify(arg, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
      );
    } catch (e) {
      return '[Unserializable/Circular Object]';
    }
  };

  const capture = (level, args) => {
    const message = Array.from(args).map(safeStringify).join(' ');
    logBuffer.push(`[${new Date().toISOString()}] [${level}] ${message}`);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  };

  console.log = function(...args) { 
    capture('LOG', args); 
    originalLog.apply(console, args); 
  };
  
  console.warn = function(...args) { 
    capture('WARN', args); 
    originalWarn.apply(console, args); 
  };
  
  console.error = function(...args) { 
    capture('ERROR', args); 
    originalError.apply(console, args); 
  };
};

export const getLogs = () => logBuffer.join('\n');
