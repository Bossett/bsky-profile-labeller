import winston from 'winston'

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({
          all: true,
        }),
        winston.format.label({
          label: '[firehose-iterable]',
        }),
        winston.format.timestamp({
          format: () => new Date().toISOString(),
        }),
        winston.format.printf(
          (info) => `${info.timestamp} ${info.level}: ${info.message}`,
        ),
      ),
    }),
  ],
})

export default logger
