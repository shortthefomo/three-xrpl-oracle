'use strict'

const { XrplClient } = require('xrpl-client')
const { derive, sign, XrplDefinitions } = require('xrpl-accountlib')
const EventEmitter = require('events')
const WebSocket = require('ws')
const Axios = require('axios')
const dotenv = require('dotenv')
const decimal = require('decimal.js')
const debug = require('debug')
const log = debug('main:backend')
const io = require('@pm2/io')

io.init({
	transactions: true, // will enable the transaction tracing
	http: true // will enable metrics about the http server (optional)
})

dotenv.config()

class backend  extends EventEmitter {
	constructor() {
		super()
		dotenv.config()

		log((process.env.XRPL_CLIENT === 'wss://s.devnet.rippletest.net:51233') ? [process.env.XRPL_CLIENT] : [process.env.XRPL_CLIENT, 'wss://xrplcluster.com', 'wss://xrpl.link', 'wss://s2.ripple.com'])
		const xrpl = new XrplClient((process.env.XRPL_CLIENT === 'wss://s.devnet.rippletest.net:51233') ? [process.env.XRPL_CLIENT] : [process.env.XRPL_CLIENT, 'wss://xrplcluster.com', 'wss://xrpl.link', 'wss://s2.ripple.com'])
		const currency = {}
		const stable = {}
		const crypto = {}
		let ledger_errors = 0

		let definitions, socket
		let connected = false
		let mode = '1min' // every/1min/5min

		Object.assign(this, {
			async run() {
				log('running')

				const liveDefinitions = await xrpl.send({ command: "server_definitions" })
				definitions = new XrplDefinitions(liveDefinitions)

				// await this.deleteDocuments()
				// return 

				this.connectWebsocket()
				this.eventListeners()
				await this.pause(5000)

				const self = this
				const callback = async (event) => {
					log('ledger close', 'mode:' + mode)
					if (mode === 'every') {
						self.emit('chunk-submit')
					}
					this.accountBalance() // dont wait!!
				}
				xrpl.on('ledger', callback)

				setInterval(async () => {
					if (mode === '1min') {
						self.emit('chunk-submit-pause')
					}
					self.emit('aggregate-price')
				}, 60_000)
				setInterval(() => {
					self.emit('check-connection')
				}, 10_000)
			},
			eventListeners() {
				this.addListener('chunk-submit', async () => {
					await this.chunckSubmit()
				})
				this.addListener('chunk-submit-pause', async () => {
					await this.chunckSubmit(false)
				})
				this.addListener('aggregate-price', async () => {
					await this.getAggregatePrice()
				})
				this.addListener('check-connection', async () => {
					this.checkConnection()
				})
				this.addListener('reconnect-websocket', async () => {
					await this.pause(10_000)
					this.connectWebsocket()
				})
			},
			async getAggregatePrice(asset = 'USD') {
				const command = {
					'command': 'get_aggregate_price',
					'ledger_index': 'current',
					'base_asset': 'XRP',
					'quote_asset': this.currencyUTF8ToHex(asset),
					'trim': 20,
					'oracles': [
						{
							'account': process.env.ACCOUNT,
							'oracle_document_id': 0
						},
						{
							'account': process.env.ACCOUNT,
							'oracle_document_id': 1
						},
						{
							'account': process.env.ACCOUNT,
							'oracle_document_id': 2
						},
						{
							'account': process.env.ACCOUNT,
							'oracle_document_id': 3
						}
					]
				}

				const response = await xrpl.send(command)
				if ('error' in response) { return }
				console.log(response)
			},
			countDecimals(value) {
				if (Math.floor(value) === value) return 0
				return value.toString().split(".")[1].length || 0
			},
			async accountBalance() {
				const acc_payload = {
					'command': 'account_info',
					'account': process.env.ACCOUNT,
					'ledger_index': 'current'
				}
				const account_info = await xrpl.send(acc_payload)
				// log(account_info)
				if ('error' in account_info) {
					log('error account_info', account_info)
					return
				}
				if ((account_info.account_data.Balance / 1_000_000) > process.env.MODE_MIN) {
					mode = 'every'
					return
				}
				mode = '1min'
			},
			checkConnected() {
				const self = this
				setInterval(async () => {
					if (!connected) {
						self.connectWebsocket()
					}
					self.checkConnection()
				}, 3800)
			},
			async checkConnection() {
                const books = {
                    'id': 4,
                    'command': 'book_offers',
                    'taker': 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8',
                    'taker_gets': {'currency': 'USD', 'issuer': 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
                    'taker_pays': {'currency': 'XRP' },
                    'limit': 10
                }

                const result = await xrpl.send(books)
                if ('error' in result) {
                    ledger_errors++
                    log('error', result.error)
                }
                if (ledger_errors > 2) {
                    xrpl.reinstate({forceNextUplink: true})
                    log('reinstate client', await xrpl.send({ command: 'server_info' }))
                    ledger_errors = 0
                }
            },
			isCrypto(token) {
				let crypto = false
				switch (token) {
					case 'BTC':
					case 'ETH':
					case 'BNB':
					case 'AAVE':
					case 'ADA':
					case 'ALGO':
					case 'AVAX':
					case 'BAT':
					case 'CAKE':
					case 'CSC':
					case 'DOGE':
					case 'DOT':
					case 'ENJ':
					case 'ENS':
					case 'EOS':
					case 'ETC':
					case 'FLR':
					case 'GALA':
					case 'HBAR':
					case 'ICP':
					case 'KAVA':
					case 'LINK':
					case 'LTC':
					case 'PEPE':
					case 'QNT':
					case 'RVN':
					case 'SHIB':
					case 'SOL':
					case 'TRX':
					case 'UNI':
					case 'VET':
					case 'WIF':
					case 'XAH':
					case 'XDC':
					case 'XLM':
					case 'ZRX':
						crypto = true
				}
				return crypto
			},
			isStable(token) {
				let stable = false
				switch (token) {
					case 'RLUSD':
					case 'BUSD':
					case 'USDC':
					case 'USDT':
					case 'USDD':
					case 'TUSD':
					case 'AUDT':
					case 'EURS':
					case 'XSGD':
					case 'MMXN':
					case 'DAI':
					case 'BIDR':
					case 'FDUSD':
					case 'PYUSD':
						stable = true
				}
				return stable
			},
			connectWebsocket() {
				const self = this
				socket = new WebSocket(process.env.ORACLE_DATA)
				socket.onmessage = function (message) {
					connected = true
					const rawData = JSON.parse(message.data)
					if ('oracle' in rawData) {
						Object.entries(rawData.oracle).forEach(([key, value]) => {
							if (key !== 'STATS') {
								if (value.Token !== undefined) {
									if (self.isStable(key)) {
										stable[key] = value
									}
									if (self.isCrypto(key)) {
										crypto[key] = value
									}
									else if (key.length === 3) {
										currency[key] = value
									}
								}
							}
						})
					}
				}
				socket.onerror = function (error) {
					log('error', error)
				}
				socket.onclose = function (event) {
					connected = false
					log('socket close')
					setTimeout(() => {
						self.emit('reconnect-websocket')
					}, 5_000)
				}
			},
			async pause(milliseconds = 1000) {
				return new Promise(resolve => {
					console.log('pausing....')
					setTimeout(resolve, milliseconds)
				})
			},
			async getSequence() {
				const acc_payload = {
					'command': 'account_info',
					'account': process.env.ACCOUNT,
					'ledger_index': 'current'
				}
				const account_info = await xrpl.send(acc_payload)
				if ('error' in account_info) {
					log('error account_info', account_info)
					return
				}
				log('account_info', account_info.account_data)
				return account_info.account_data.Sequence
			},
			async chunckSubmit(Pause = true) {
				const ChunkSize = 10
				if (!connected) {
					log('oracle websocket disconnected')
					return
				}
				if (Pause) {
					await this.pause(1200)
				}

				
				let Sequence = await this.getSequence()
				if (Sequence === undefined) { return }

				const server_info = await xrpl.send({ 'command': 'server_info' })
				if ('error' in server_info) {
					log('error server_info', server_info)
					return
				}
				const base_fee = server_info.info.validated_ledger.base_fee_xrp * 1_000_000
				const Fee = String(base_fee)

				let OracleDocumentID = 0

				const StableDataSeries = []
				Object.entries(stable).sort().forEach(([QuoteAsset, value]) => {
					// log(value)
					const price = new decimal(value.Price).toFixed(10) * 1
					const scale = this.countDecimals(price)
					const data = {
						'PriceData': {
							'BaseAsset': 'XRP',
							'QuoteAsset': this.currencyUTF8ToHex(QuoteAsset),
							'AssetPrice': Math.round(price * Math.pow(10, scale)),
							'Timestamp': value.Timestamp
						}
					}
					if (scale > 0) {
						data.PriceData.Scale = this.countDecimals(price)
					}
					StableDataSeries.push(data)

					const value2 = value.Price / currency.USD.Price
					const scale2 = this.countDecimals(value2)
					const data2 = {
						'PriceData': {
							'BaseAsset': 'USD',
							'QuoteAsset': this.currencyUTF8ToHex(QuoteAsset),
							'AssetPrice': Math.round(value2 * Math.pow(10, scale2)),
							'Timestamp': value.Timestamp
						}
					}
					if (scale2 > 0) {
						data2.PriceData.Scale = this.countDecimals(value2)
					}
					StableDataSeries.push(data2)
				})

				for (let i = 0; i < StableDataSeries.length; i += ChunkSize) {
					const chunk = StableDataSeries.slice(i, i + ChunkSize)
					let result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'stable token')
					if (result === 'tecARRAY_TOO_LARGE' || result === 'temMALFORMED') {
						Sequence = await this.deleteDocumentInstance(OracleDocumentID, Fee)
					}
					if (result === 'tefPAST_SEQ') {
						Sequence = await this.getSequence()
						result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'stable token')
					}
					Sequence++
					OracleDocumentID++
				}

				const CryptoDataSeries = []
				Object.entries(crypto).sort().forEach(([QuoteAsset, value]) => {
					// log(value)
					const price = new decimal(value.Price).toFixed(10) * 1
					const scale = this.countDecimals(price)
					const data = {
						'PriceData': {
							'BaseAsset': 'XRP',
							'QuoteAsset': this.currencyUTF8ToHex(QuoteAsset),
							'AssetPrice': Math.round(price * Math.pow(10, scale)),
							'Timestamp': value.Timestamp
						}
					}
					if (scale > 0) {
						data.PriceData.Scale = this.countDecimals(price)
					}
					CryptoDataSeries.push(data)
				})
				for (let i = 0; i < CryptoDataSeries.length; i += ChunkSize) {
					const chunk = CryptoDataSeries.slice(i, i + ChunkSize)
					const result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'crypto token')
					if (result === 'tecARRAY_TOO_LARGE' || result === 'temMALFORMED') {
						Sequence = await this.deleteDocumentInstance(OracleDocumentID, Fee)
					}
					if (result === 'tefPAST_SEQ') {
						Sequence = await this.getSequence()
						result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'crypto token')
					}
					Sequence++
					OracleDocumentID++
				}

				const CurrencyDataSeries = []
				Object.entries(currency).sort().forEach(([QuoteAsset, value]) => {
					// log(value)
					const price = new decimal(value.Price).toFixed(10) * 1
					const scale = this.countDecimals(price)
					const data = {
						'PriceData': {
							'BaseAsset': 'XRP',
							'QuoteAsset': this.currencyUTF8ToHex(QuoteAsset),
							'AssetPrice': Math.round(price * Math.pow(10, scale)),
							'Timestamp': value.Timestamp
						}
					}
					if (scale > 0) {
						data.PriceData.Scale = this.countDecimals(price)
					}
					CurrencyDataSeries.push(data)
				})
				for (let i = 0; i < CurrencyDataSeries.length; i += ChunkSize) {
					const chunk = CurrencyDataSeries.slice(i, i + ChunkSize)
					const result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'currency')
					if (result === 'tecARRAY_TOO_LARGE' || result === 'temMALFORMED') {
						Sequence = await this.deleteDocumentInstance(OracleDocumentID, Fee)
					}
					if (result === 'tefPAST_SEQ') {
						Sequence = await this.getSequence()
						result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'currency')
					}
					Sequence++
					OracleDocumentID++
				}
			},
			async submit(PriceDataSeries, Sequence, Fee, OracleDocumentID, AssetClass = 'currency') {
				const pairs = {}
				const series = []
				for (let index = 0; index < PriceDataSeries.length; index++) {
					const element = PriceDataSeries[index]
					const token = element.PriceData.BaseAsset + this.currencyHexToUTF8(element.PriceData.QuoteAsset)
					pairs[token] = element.PriceData.Scale === undefined ? element.PriceData.AssetPrice : element.PriceData.AssetPrice / Math.pow(10, element.PriceData.Scale)

					if (new Date().getTime() - element.PriceData.Timestamp < process.env.MIN_TIME) {
						delete element.PriceData.Timestamp
						series.push(element)
					}
				}

				if (series.length === 0) { return }
				// push data into the XRPL
				const OracleSet = {
					'TransactionType': 'OracleSet',
					'Account': process.env.ACCOUNT,
					'OracleDocumentID': OracleDocumentID,
					//# "provider"
					'Provider': Buffer.from(process.env.URL, 'utf-8').toString('hex').toUpperCase(),
					'LastUpdateTime': (new Date().getTime() / 1000), // WHY NO ripple time stamp!
					// # "currency"
					'AssetClass': Buffer.from(AssetClass, 'utf-8').toString('hex').toUpperCase(),
					'PriceDataSeries': series,
					'Sequence': Sequence,
					'Fee': Fee
				}
				const result = await this.sign(OracleSet)
				if (result.engine_result === 'tefPAST_SEQ') {
					await this.submit(PriceDataSeries, Sequence++, Fee, OracleDocumentID, AssetClass)
				}
				console.log('OracleDocumentID', AssetClass, OracleDocumentID, result.engine_result, pairs)

				// if (result.engine_result === 'temMALFORMED') {
				// 	log('OracleSet', OracleSet.PriceDataSeries)
				// }
				return result.engine_result
			},
			async sign(tx_json) {
				const master = derive.familySeed(process.env.SECRET)
				const { signedTransaction } = sign(tx_json, master, definitions)
				const transaction = await xrpl.send({
					command: 'submit',
					tx_blob: signedTransaction
				})
				return transaction
			},
			currencyUTF8ToHex(code) {
				if (code.length === 3) { return code }
				const characters = Buffer.from(code, 'utf8').toString('hex')
				let s = '0'
				for (let index = 1; index < 40 - characters.length; index++) {
					s = s + '0'
				}

				return (characters + s).toUpperCase()
			},
			currencyHexToUTF8(code) {
				if (code.length === 3)
					return code
				let decoded = new TextDecoder().decode(this.hexToBytes(code))
				let padNull = decoded.length
				while (decoded.charAt(padNull - 1) === '\0')
					padNull--
				return decoded.slice(0, padNull)
			},
			hexToBytes(hex) {
				let bytes = new Uint8Array(hex.length / 2)
				for (let i = 0; i !== bytes.length; i++) {
					bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
				}
				return bytes
			},
			async deleteDocuments() {
				const OracleDelete = {
					'TransactionType': 'OracleDelete',
					'Account': process.env.ACCOUNT,
					'OracleDocumentID': 34
				}

				const acc_payload = {
					'command': 'account_info',
					'account': process.env.ACCOUNT,
					'ledger_index': 'current'
				}
				const account_info = await xrpl.send(acc_payload)
				if ('error' in account_info) {
					log('error account_info', account_info)
					return
				}
				let Sequence = account_info.account_data.Sequence

				const server_info = await xrpl.send({ 'command': 'server_info' })
				if ('error' in server_info) {
					log('error server_info', server_info)
					return
				}
				const base_fee = server_info.info.validated_ledger.base_fee_xrp * 1_000_000
				const Fee = String(base_fee)

				OracleDelete.Fee = Fee
				OracleDelete.Sequence = Sequence

				for (let index = 0; index < 10; index++) {
					OracleDelete.OracleDocumentID = index
					await this.sign(OracleDelete)
					OracleDelete.Sequence++
				}

			},
			async deleteDocumentInstance(OracleDocumentID, Fee) {
				const OracleDelete = {
					'TransactionType': 'OracleDelete',
					'Account': process.env.ACCOUNT,
					'OracleDocumentID': OracleDocumentID
				}

				const acc_payload = {
					'command': 'account_info',
					'account': process.env.ACCOUNT,
					'ledger_index': 'current'
				}
				const account_info = await xrpl.send(acc_payload)
				if ('error' in account_info) {
					log('error account_info', account_info)
					return
				}
				let Sequence = account_info.account_data.Sequence

				OracleDelete.Fee = String(Fee)
				OracleDelete.Sequence = Sequence
				// log(OracleDelete)
				const result = await this.sign(OracleDelete)
				console.log('OracleDelete', result.engine_result)
				return Sequence
			},
			async checkConnection() {
				log('checking connection')
				const books = {
					'id': 4,
					'command': 'book_offers',
					'taker': 'rrrrrrrrrrrrrrrrrrrrBZbvji',
					'taker_gets': {'currency': 'USD', 'issuer': 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
					'taker_pays': {'currency': 'XRP' },
					'limit': 100
				}

				const result = await xrpl.send(books)
				if ('error' in result) {
					ledger_errors++
					log('error', result.error)
				}
				if (ledger_errors > 2) {
					xrpl.reinstate({forceNextUplink: true})
					log('reinstate client', await xrpl.send({ command: 'server_info' }))
					ledger_errors = 0
				}

			},
		})
	}
}

const main = new backend()
main.run()


