const _ = require('lodash');
const functionArguments = require('function-arguments');
const Ajv = require('ajv');
const WebSocketServer = require('uws').Server;
const logger = {};

class Respect
{
    constructor(config)
    {
        if(typeof config.logger === 'function')
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
            logger.log('info', 'Connection established.');
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

    async handleCall(json)
    {
        let result;
        const id = (typeof json.id === "string" || typeof json.id === "number" || json.id === null) ? json.id : undefined;
        
        if(json.jsonrpc !== this.VERSION)
        {
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

        if(!json.params)
        {
            if(_.isPlainObject(schema))
            {
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
                    return {
                        jsonrpc: this.VERSION,
                        error:
                        {
                            code: this.status.INTERNAL_ERROR,
                            message: `Internal error: ${error.message}`,
                            data:
                            {
                                stack: error.stack
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
                return {
                    jsonrpc: this.VERSION,
                    error:
                    {
                        code: this.status.INTERNAL_ERROR,
                        message: `Internal error: ${error.message}`,
                        data:
                        {
                            stack: error.stack
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
                return {
                    jsonrpc: this.VERSION,
                    error:
                    {
                        code: this.status.INTERNAL_ERROR,
                        message: `Internal error: ${error.message}`,
                        data:
                        {
                            stack: error.stack
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
            return ws.send(JSON.stringify(
            {
                jsonrpc: this.VERSION,
                error:
                {
                    code: this.status.PARSE_ERROR,
                    message: 'Unable to parse JSON',
                    data:
                    {
                        stack: error.stack
                    }
                },
                id: null
            }));
        }

        if(!Array.isArray(json))
        {
            const response = await this.handleCall(json);

            if(response.id !== undefined)
            {
                ws.send(JSON.stringify(response));
            }
        }

        else
        {
            const items = _.map(json, (item) => this.handleCall(item));
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