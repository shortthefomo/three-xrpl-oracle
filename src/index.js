'use strict'

const { XrplClient } = require('xrpl-client')
const { derive, sign, XrplDefinitions } = require('xrpl-accountlib')
const WebSocket = require('ws')
const Axios = require('axios')
const dotenv = require('dotenv')
const debug = require('debug')
const log = debug('main:backend')
const io = require('@pm2/io')

io.init({
	transactions: true, // will enable the transaction tracing
	http: true // will enable metrics about the http server (optional)
})

dotenv.config()

class backend {
	constructor() {
		dotenv.config()

		const xrpl = new XrplClient(['wss://s.devnet.rippletest.net:51233', 'wss://clio.devnet.rippletest.net:51233'])
		const currency = {}
		const stable = {}
		const crypto = {}

		let definitions, socket
		let connected = false
		let ledger_errors = 0
		let mode = '1min' // every/1min/5min

		Object.assign(this, {
			async run() {
				log('running')

				const liveDefinitions = await xrpl.send({ command: "server_definitions" })
				definitions = new XrplDefinitions(liveDefinitions)

				// await this.deleteDocuments()
				// return 

				this.connectWebsocket()
				await this.pause(5000)

				const self = this
				const callback = async (event) => {
					log('ledger close', 'mode:' + mode)
					if (mode === 'every') {
						await self.chunckSubmit()
					}
					this.accountBalance() // dont wait!!
				}
				xrpl.on('ledger', callback)

				setInterval(async () => {
					if (mode === '1min') {
						await self.chunckSubmit(false)
					}
					await self.getAggregatePrice()
				}, 60000)

				this.checkConnected()
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
			connectWebsocket() {
				const self = this
				log('connecting to wss://three-oracle.panicbot.xyz')
				socket = new WebSocket('wss://three-oracle.panicbot.xyz')
				socket.onmessage = function (message) {
					connected = true
					const rawData = JSON.parse(message.data)
					if ('oracle' in rawData) {
						Object.entries(rawData.oracle).forEach(([key, value]) => {
							if (key !== 'STATS') {
								if (value.Token !== undefined) {
									if (key.length > 3) {
										stable[key] = value
									}
									if (key === 'BTC' || key === 'ETH' || key === 'BNB') {
										crypto[key] = value
									}
									else if (key.length === 3) {
										currency[key] = value
									}
								}
							}
						})
					}
					// log(data)
				}
				socket.onerror = function (error) {
					log('error', error)
				}
				socket.onclose = function (event) {
					connected = false
					log('socket close', event)
					setTimeout(() => {
						self.connectWebsocket()
					}, 1000)
				}
			},
			async pause(milliseconds = 1000) {
				return new Promise(resolve => {
					console.log('pausing....')
					setTimeout(resolve, milliseconds)
				})
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

				let OracleDocumentID = 0

				const StableDataSeries = []
				Object.entries(stable).sort().forEach(([QuoteAsset, value]) => {
					// log(value)
					const scale = this.countDecimals(value.Price)
					const data = {
						'PriceData': {
							'BaseAsset': 'XRP',
							'QuoteAsset': this.currencyUTF8ToHex(QuoteAsset),
							'AssetPrice': Math.round(value.Price * Math.pow(10, scale)),
							'Timestamp': value.Timestamp
						}
					}
					if (scale > 0) {
						data.PriceData.Scale = this.countDecimals(value.Price)
					}
					StableDataSeries.push(data)
				})
				for (let i = 0; i < StableDataSeries.length; i += ChunkSize) {
					const chunk = StableDataSeries.slice(i, i + ChunkSize)
					const result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'stable token')
					if (result === 'tecARRAY_TOO_LARGE' || result === 'temMALFORMED') {
						await this.deleteDocumentInstance(OracleDocumentID, Fee)
					}
					Sequence++
					OracleDocumentID++
				}

				const CryptoDataSeries = []
				Object.entries(crypto).sort().forEach(([QuoteAsset, value]) => {
					// log(value)
					const scale = this.countDecimals(value.Price)
					const data = {
						'PriceData': {
							'BaseAsset': 'XRP',
							'QuoteAsset': this.currencyUTF8ToHex(QuoteAsset),
							'AssetPrice': Math.round(value.Price * Math.pow(10, scale)),
							'Timestamp': value.Timestamp
						}
					}
					if (scale > 0) {
						data.PriceData.Scale = this.countDecimals(value.Price)
					}
					CryptoDataSeries.push(data)
				})
				for (let i = 0; i < CryptoDataSeries.length; i += ChunkSize) {
					const chunk = CryptoDataSeries.slice(i, i + ChunkSize)
					const result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'crypto token')
					if (result === 'tecARRAY_TOO_LARGE' || result === 'temMALFORMED') {
						await this.deleteDocumentInstance(OracleDocumentID, Fee)
					}
					Sequence++
					OracleDocumentID++
				}

				const CurrencyDataSeries = []
				Object.entries(currency).sort().forEach(([QuoteAsset, value]) => {
					// log(value)
					const scale = this.countDecimals(value.Price)
					const data = {
						'PriceData': {
							'BaseAsset': 'XRP',
							'QuoteAsset': this.currencyUTF8ToHex(QuoteAsset),
							'AssetPrice': Math.round(value.Price * Math.pow(10, scale)),
							'Timestamp': value.Timestamp
						}
					}
					if (scale > 0) {
						data.PriceData.Scale = this.countDecimals(value.Price)
					}
					CurrencyDataSeries.push(data)
				})
				for (let i = 0; i < CurrencyDataSeries.length; i += ChunkSize) {
					const chunk = CurrencyDataSeries.slice(i, i + ChunkSize)
					const result = await this.submit(chunk, Sequence, Fee, OracleDocumentID, 'currency')
					if (result === 'tecARRAY_TOO_LARGE' || result === 'temMALFORMED') {
						await this.deleteDocumentInstance(OracleDocumentID, Fee)
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
					'Provider': Buffer.from('https://threexrp.dev', 'utf-8').toString('hex').toUpperCase(),
					'LastUpdateTime': (new Date().getTime() / 1000), // WHY NO ripple time stamp!
					// # "currency"
					'AssetClass': Buffer.from(AssetClass, 'utf-8').toString('hex').toUpperCase(),
					'PriceDataSeries': series,
					'Sequence': Sequence,
					'Fee': Fee
				}
				const result = await this.sign(OracleSet)
				console.log('OracleDocumentID', OracleDocumentID, result.engine_result, pairs)

				// if (result.engine_result === 'temMALFORMED') {
				// 	log('OracleSet', OracleSet.PriceDataSeries)
				// }
				return result.engine_result
			},
			async sign(tx_json) {
				const master = derive.familySeed(process.env.SECRET)
				// log('sign', tx_json)
				const { signedTransaction } = sign(tx_json, master, definitions)
				// console.log('signedTransaction', signedTransaction)


				const transaction = await xrpl.send({
					command: 'submit',
					tx_blob: signedTransaction
				})
				// log(tx_json.PriceDataSeries)
				// console.log('transaction', transaction)
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
			},
		})
	}
}

const main = new backend()
main.run()


