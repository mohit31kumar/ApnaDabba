enum LogLevel {
  INFO = 'INFO',
  ERROR = 'ERROR',
  WARN = 'WARN',
  DEBUG = 'DEBUG',
}

interface LogMessage {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

class Logger {
  private formatLog(level: LogLevel, message: string, data?: any): LogMessage {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
  }

  info(message: string, data?: any) {
    console.log(JSON.stringify(this.formatLog(LogLevel.INFO, message, data)));
  }

  error(message: string, data?: any) {
    console.error(JSON.stringify(this.formatLog(LogLevel.ERROR, message, data)));
  }

  warn(message: string, data?: any) {
    console.warn(JSON.stringify(this.formatLog(LogLevel.WARN, message, data)));
  }

  debug(message: string, data?: any) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(JSON.stringify(this.formatLog(LogLevel.DEBUG, message, data)));
    }
  }
}

export const logger = new Logger();
