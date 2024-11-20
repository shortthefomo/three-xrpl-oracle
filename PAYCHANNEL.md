## access RawData 
collected from all excahnges threexp.dev is connected to


First link your wallet to `https://dhali.io` create and fund a payment channel

Now call the `https://dhali.io` API with those headers like so at our URI `https://run.api.dhali.io/d74e99cb-166d-416b-b171-4d313e0f079d/`

`curl -H "Payment-Claim: $PAYMENT_CLAIM" \https://run.api.dhali.io/d74e99cb-166d-416b-b171-4d313e0f079d/`

the oracle charges 0.00005 XRP per request