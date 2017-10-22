const _ = require('lodash');
const {format} = require('date-fns');
const functionArguments = require('function-arguments');
const Ajv = require('ajv');
const WebSocketServer = require('uws').Server;
let logger = {};

class Respect
{
    constructor(config)
    {
        if(config.logger && typeof config.logger.log === 'function')
        {
            logger = config.logger;
        }

        else if(typeof config.logger === 'function')
        {
            logger.log = config.logger;
        }

        else if(config.logger === true)
        {
            logger.log = (...args) => console.log(...args);
        }

        else
        {
            logger.log = () => {};
        }

        this.VERSION = '2.0';
        this.instance = config.instance;
        this.wss = new WebSocketServer(config.uwsOptions);
        this.wss.on('connection', (ws) =>
        {
            ws.remoteAddress = ws.upgradeReq.headers['x-forwarded-for'] || ws._socket.remoteAddress.replace(/^::ffff:/, '');
            logger.log('info', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Connection established`);
            ws.on('message', (message) => this.handleMessage(message, ws));
        });
    }

    get status()
    {
        return {
            PARSE_ERROR: -32700,
            INVALID_REQUEST: -32600,
            METHOD_NOT_FOUND: -32601,
            INVALID_PARAMS: -32602,
            INTERNAL_ERROR: -32603
        }
    }

    async handleCall(json, ws)
    {
        let result;
        const id = (typeof json.id === "string" || typeof json.id === "number" || json.id === null) ? json.id : undefined;
        
        if(json.jsonrpc !== this.VERSION)
        {
            logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Invalid request`);

            return {
                jsonrpc: this.VERSION,
                error:
                {
                    code: this.status.INVALID_REQUEST,
                    message: 'Invalid or missing "jsonrpc" property.',
                    data:
                    {
                        expected: {jsonrpc: this.VERSION}
                    }
                },
                id
            };
        }

        if(!json.method || typeof json.method !== 'string')
        {
            logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Invalid request`);

            return {
                jsonrpc: this.VERSION,
                error:
                {
                    code: this.status.INVALID_REQUEST,
                    message: 'Invalid or missing "method" property.'
                },
                id
            };
        }

        const method = _.get(this.instance, json.method);
        const schema = _.get(this.instance.schema, json.method);

        if(typeof method !== 'function')
        {
            logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Method not found`);

            return {
                jsonrpc: this.VERSION,
                error:
                {
                    code: this.status.METHOD_NOT_FOUND,
                    message: `Method not found: ${json.method}`
                },
                id
            };
        }

        logger.log('info', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Call method: ${method.name}`);

        if(!json.params)
        {
            if(_.isPlainObject(schema))
            {
                logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Invalid params`);
                
                return {
                    jsonrpc: this.VERSION,
                    error:
                    {
                        code: this.status.INVALID_PARAMS,
                        message: `Supplied parameters do not match schema for method: ${json.method}`,
                        data: schema
                    },
                    id
                };
            }

            else
            {
                try
                {
                    result = method();
                    
                    if(result instanceof Promise)
                    {
                        result = await result;
                    }

                    if(!['string', 'number', 'boolean'].includes(typeof result) && result !== null && !Array.isArray(result) && !_.isPlainObject(result))
                    {
                        throw new Error(`Method: ${json.method} returned an invalid value. Expected [String|Number|Boolean|Null|Array|Object].`);
                    }
                }

                catch(error)
                {
                    logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Internal error`);

                    return {
                        jsonrpc: this.VERSION,
                        error:
                        {
                            code: this.status.INTERNAL_ERROR,
                            message: `Internal error: ${error.message}`,
                            data:
                            {
                                columnNumber: process.env.NODE_ENV === 'production' ?  undefined : error.columnNumber,
                                description: process.env.NODE_ENV === 'production' ?  undefined : error.description,
                                fileName: process.env.NODE_ENV === 'production' ?  undefined : error.fileName,
                                lineNumber: process.env.NODE_ENV === 'production' ?  undefined : error.lineNumber,
                                message: error.message,
                                name: error.name,
                                number: error.number,
                                stack: process.env.NODE_ENV === 'production' ?  undefined : error.stack
                            }
                        },
                        id
                    };
                }

                return {
                    jsonrpc: this.VERSION,
                    result,
                    id
                };
            }
        }

        if(_.isPlainObject(json.params))
        {
            if(_.isPlainObject(schema))
            {
                const ajv = new Ajv();
                const isValid = ajv.validate(schema, json.params);
    
                if(!isValid)
                {
                    logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Invalid params`);

                    return {
                        jsonrpc: this.VERSION,
                        error:
                        {
                            code: this.status.INVALID_PARAMS,
                            message: `Supplied parameters do not match schema for method: ${json.method}`,
                            data:
                            {
                                expected: schema
                            }
                        },
                        id
                    };
                }
            }  

            try
            {
                result = method(json.params);
                
                if(result instanceof Promise)
                {
                    result = await result;
                }

                if(!['string', 'number', 'boolean'].includes(typeof result) && result !== null && !Array.isArray(result) && !_.isPlainObject(result))
                {
                    throw new Error(`Method: ${json.method} returned an invalid value. Expected [String|Number|Boolean|Null|Array|Object].`);
                }
            }

            catch(error)
            {
                logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Internal error`);

                return {
                    jsonrpc: this.VERSION,
                    error:
                    {
                        code: this.status.INTERNAL_ERROR,
                        message: `Internal error: ${error.message}`,
                        data:
                        {
                            columnNumber: process.env.NODE_ENV === 'production' ?  undefined : error.columnNumber,
                            description: process.env.NODE_ENV === 'production' ?  undefined : error.description,
                            fileName: process.env.NODE_ENV === 'production' ?  undefined : error.fileName,
                            lineNumber: process.env.NODE_ENV === 'production' ?  undefined : error.lineNumber,
                            message: error.message,
                            name: error.name,
                            number: error.number,
                            stack: process.env.NODE_ENV === 'production' ?  undefined : error.stack
                        }
                    },
                    id
                };
            }

            return {
                jsonrpc: this.VERSION,
                result,
                id
            };
        }

        else
        {
            const args = functionArguments(method);

            if(args.length !== json.params.length)
            {
                logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Invalid params`);

                return {
                    jsonrpc: this.VERSION,
                    error:
                    {
                        code: this.status.INVALID_PARAMS,
                        message: `Supplied parameters do not match signature for method: ${json.method}`,
                        data:
                        {
                            expected: args
                        }
                    },
                    id
                };
            }

            try
            {
                result = method(...json.params);
                
                if(result instanceof Promise)
                {
                    result = await result;
                }

                if(!['string', 'number', 'boolean'].includes(typeof result) && result !== null && !Array.isArray(result) && !_.isPlainObject(result))
                {
                    throw new Error(`Method: ${json.method} returned an invalid value. Expected [String|Number|Boolean|Null|Array|Object].`);
                }
            }

            catch(error)
            {
                logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Internal error`);

                return {
                    jsonrpc: this.VERSION,
                    error:
                    {
                        code: this.status.INTERNAL_ERROR,
                        message: `Internal error: ${error.message}`,
                        data:
                        {
                            columnNumber: process.env.NODE_ENV === 'production' ?  undefined : error.columnNumber,
                            description: process.env.NODE_ENV === 'production' ?  undefined : error.description,
                            fileName: process.env.NODE_ENV === 'production' ?  undefined : error.fileName,
                            lineNumber: process.env.NODE_ENV === 'production' ?  undefined : error.lineNumber,
                            message: error.message,
                            name: error.name,
                            number: error.number,
                            stack: process.env.NODE_ENV === 'production' ?  undefined : error.stack
                        }
                    },
                    id
                };
            }

            return {
                jsonrpc: this.VERSION,
                result,
                id
            };
        }
    }

    async handleMessage(message, ws)
    {
        let json;

        try
        {
            json = JSON.parse(message);
        }

        catch(error)
        {
            logger.log('error', `${ws.remoteAddress} - - [${format(new Date(), 'DD/MMM/YYYY HH:mm:ss ZZ')}] Parse error`);

            return ws.send(JSON.stringify(
            {
                jsonrpc: this.VERSION,
                error:
                {
                    code: this.status.PARSE_ERROR,
                    message: 'Unable to parse JSON',
                    data:
                    {
                        stack: process.env.NODE_ENV === 'production' ?  undefined : error.stack
                    }
                },
                id: null
            }));
        }

        if(!Array.isArray(json))
        {
            const response = await this.handleCall(json, ws);

            if(response.id !== undefined)
            {
                ws.send(JSON.stringify(response));
            }
        }

        else
        {
            const items = _.map(json, (item) => this.handleCall(item, ws));
            let batch = await Promise.all(items);
            batch = _.filter(batch, (response) => response.id !== undefined);
            
            if(batch.length)
            {
                ws.send(JSON.stringify(batch));
            }
        }
    }
}

module.exports = Respect;
