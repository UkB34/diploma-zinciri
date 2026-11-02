// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Yöntem 1: Her diploma ayrı, devredilemez (soulbound, ERC-5192) bir NFT.
// Zincirde kişisel veri yoktur: yalnızca diploma VC'sinin SHA-256 özeti tutulur.
// tokenId = diploma kodundaki 20 haneli onaltılık sayı (TEST-<20 hex>), böylece aynı diploma iki kez basılamaz.

import "@openzeppelin/contracts@5.1.0/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts@5.1.0/access/Ownable.sol";

contract DiplomaNFT is ERC721, Ownable {
    // Diplomayı düzenleyen üniversitenin DID'i (VC'lerdeki issuer ile aynı).
    string public issuerDid;
    // tokenId => diploma VC JWT'sinin SHA-256 özeti
    mapping(uint256 => bytes32) public credentialHash;
    // tokenId => iptal edildi mi
    mapping(uint256 => bool) public revoked;
    // Kayıt yapabilen cüzdanlar (platform modelinde birden fazla üniversite cüzdanı eklenebilir)
    mapping(address => bool) public issuers;

    string private baseUri;
    uint256 public constant MAX_BATCH = 150;

    // ERC-5192 (Minimal Soulbound NFT)
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    event DiplomaRevoked(uint256 indexed tokenId);
    event IssuerSet(address indexed issuer, bool allowed);

    constructor(string memory did, string memory metadataBaseUri)
        ERC721("Diploma Zinciri Diploma", "DZD")
        Ownable(msg.sender)
    {
        issuerDid = did;
        baseUri = metadataBaseUri;
        issuers[msg.sender] = true;
        emit IssuerSet(msg.sender, true);
    }

    modifier onlyIssuer() {
        require(issuers[msg.sender], "DiplomaNFT: yetkisiz cuzdan");
        _;
    }

    function setIssuer(address account, bool allowed) external onlyOwner {
        issuers[account] = allowed;
        emit IssuerSet(account, allowed);
    }

    // Bir veya birden çok diplomayı tek işlemde basar. NFT'ler basan üniversite cüzdanında kalır.
    function mintBatch(uint256[] calldata tokenIds, bytes32[] calldata hashes) external onlyIssuer {
        uint256 n = tokenIds.length;
        require(n > 0 && n == hashes.length && n <= MAX_BATCH, "DiplomaNFT: gecersiz paket");
        for (uint256 i = 0; i < n; i++) {
            require(hashes[i] != bytes32(0), "DiplomaNFT: bos ozet");
            credentialHash[tokenIds[i]] = hashes[i];
            _mint(msg.sender, tokenIds[i]); // aynı tokenId ikinci kez basılamaz
            emit Locked(tokenIds[i]);
        }
    }

    function revoke(uint256 tokenId) external onlyIssuer {
        _requireOwned(tokenId);
        require(!revoked[tokenId], "DiplomaNFT: zaten iptal");
        revoked[tokenId] = true;
        emit DiplomaRevoked(tokenId);
    }

    // Doğrulama: zincirdeki özet verilen VC özetiyle aynı mı, iptal edilmiş mi?
    function verify(uint256 tokenId, bytes32 vcHash) external view returns (bool registered, bool matches, bool isRevoked) {
        bytes32 stored = credentialHash[tokenId];
        return (stored != bytes32(0), stored == vcHash, revoked[tokenId]);
    }

    // ERC-5192: bütün diplomalar kalıcı olarak kilitli (devredilemez).
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    // Soulbound: yalnızca basıma izin verilir; transfer ve yakma engellenir.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        require(_ownerOf(tokenId) == address(0), "DiplomaNFT: diploma devredilemez");
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId); // 0xb45a3c0e = ERC-5192
    }

    function _baseURI() internal view override returns (string memory) {
        return baseUri;
    }
}
