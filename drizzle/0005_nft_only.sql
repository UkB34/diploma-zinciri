-- Testing is over: the Merkle method is dropped and only real diplomas stay on chain as NFTs.
-- Removes the Merkle (anchor) records, the measurement runs and the generated measurement diplomas.
DELETE FROM chain_records WHERE method <> 'nft';
DELETE FROM chain_records WHERE code IN (SELECT subject FROM credentials WHERE kind = 'bench');
DELETE FROM chain_records WHERE batch_id IN (SELECT id FROM chain_batches WHERE action = 'register');
DELETE FROM chain_batches WHERE method <> 'nft' OR action = 'register' OR status IN ('prepared', 'cancelled');
DELETE FROM credentials WHERE kind = 'bench';
