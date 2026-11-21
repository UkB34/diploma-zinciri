-- Sepolia is no longer used: diplomas are recorded as NFTs in a Solana (Metaplex Core) collection,
-- minted with tools/solana/diploma_nft.py and verified straight from the chain. The Sepolia NFTs stay on chain.
DROP TABLE IF EXISTS chain_records;
DROP TABLE IF EXISTS chain_batches;
