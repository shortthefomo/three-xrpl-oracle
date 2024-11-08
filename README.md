# THREE XRPL ORACLE PUBLISHER

pushes oracle data into the XRPL. via the address roosteri9aGNFRXZrJNYQKVBfxHiE5abg

## install
- install pm2 on machine if not there
- copy .env-sample to .env and adjust with a dev net account of your own
- `yarn` or `npm install`
- `./run.sh` and it will launch a pm2 process with the daemon


## access API via payment channel

A small example.
Get the attestation parameters from the OracleSet transaction, where "currency:91963150:91586706:3" is the slugs in the URI like this one https://livenet.xrpl.org/transactions/1C278595C8965AE5DA7848550FC56D898B19D2CA7EBFC36C8EED23887FB383D3

Now call the https://dhali.io API with those headers like so at our URI https://run.api.dhali.io/d74e99cb-166d-416b-b171-4d313e0f079d/

curl -H "Payment-Claim: $PAYMENT_CLAIM" -H "attestation:currency:91963150:91586706:3" \https://run.api.dhali.io/d74e99cb-166d-416b-b171-4d313e0f079d/
