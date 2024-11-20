# THREE XRPL ORACLE PUBLISHER

pushes oracle data into the XRPL. via the address roosteri9aGNFRXZrJNYQKVBfxHiE5abg

## install
- install pm2 on machine if not there
- copy .env-sample to .env and adjust with a dev net account of your own
- `yarn` or `npm install`
- `./run.sh` and it will launch a pm2 process with the daemon

## accessing on ledger data

follow the gist `https://gist.github.com/shortthefomo/4f47d90200f87dc503e3f3f04494b918`

## access Attestations

each OracleSet operation has a URI defined like this one `https://livenet.xrpl.org/transactions/1C278595C8965AE5DA7848550FC56D898B19D2CA7EBFC36C8EED23887FB383D3`
simple get the data from the defined URI.

## access RawData 
collected from all excahnges threexp.dev is connected to


First link your wallet to `https://dhali.io` create and fund a payment channel

Now call the `https://dhali.io` API with those headers like so at our URI `https://run.api.dhali.io/d74e99cb-166d-416b-b171-4d313e0f079d/`

`curl -H "Payment-Claim: $PAYMENT_CLAIM" \https://run.api.dhali.io/d74e99cb-166d-416b-b171-4d313e0f079d/`

the oracle charges 0.00005 XRP per request