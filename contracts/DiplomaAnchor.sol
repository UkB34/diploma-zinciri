// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Yöntem 2: Merkle kökü ile toplu kayıt (Blockcerts yaklaşımı).
// Bir grup diploma VC'sinin özetlerinden Merkle ağacı kurulur; zincire tek işlemle yalnızca kök yazılır.
// Yaprak  = SHA-256(diploma VC JWT)
// Düğüm   = SHA-256(0x01 || küçük || büyük)   (sıralı çiftler, kanıtta konum bilgisi gerekmez)
// Tek sayıda düğüm kalırsa sonuncusu bir üst seviyeye aynen taşınır.

import "@openzeppelin/contracts@5.1.0/access/Ownable.sol";

contract DiplomaAnchor is Ownable {
    struct Batch {
        bytes32 root;
        uint32 count;
        uint64 anchoredAt;
    }

    string public issuerDid;
    Batch[] public batches;
    // kök => paket sırası + 1 (0 = kayıtlı değil)
    mapping(bytes32 => uint256) public batchOf;
    // yaprak (VC özeti) => iptal edildi mi
    mapping(bytes32 => bool) public revokedLeaf;
    mapping(address => bool) public issuers;

    event Anchored(uint256 indexed batchIndex, bytes32 indexed root, uint32 count);
    event LeafRevoked(bytes32 indexed leaf);
    event IssuerSet(address indexed issuer, bool allowed);

    constructor(string memory did) Ownable(msg.sender) {
        issuerDid = did;
        issuers[msg.sender] = true;
        emit IssuerSet(msg.sender, true);
    }

    modifier onlyIssuer() {
        require(issuers[msg.sender], "DiplomaAnchor: yetkisiz cuzdan");
        _;
    }

    function setIssuer(address account, bool allowed) external onlyOwner {
        issuers[account] = allowed;
        emit IssuerSet(account, allowed);
    }

    function anchor(bytes32 root, uint32 count) external onlyIssuer returns (uint256 batchIndex) {
        require(root != bytes32(0) && count > 0, "DiplomaAnchor: gecersiz kok");
        require(batchOf[root] == 0, "DiplomaAnchor: kok zaten kayitli");
        batches.push(Batch(root, count, uint64(block.timestamp)));
        batchIndex = batches.length - 1;
        batchOf[root] = batches.length;
        emit Anchored(batchIndex, root, count);
    }

    function revokeLeaf(bytes32 leaf) external onlyIssuer {
        require(!revokedLeaf[leaf], "DiplomaAnchor: zaten iptal");
        revokedLeaf[leaf] = true;
        emit LeafRevoked(leaf);
    }

    function batchCount() external view returns (uint256) {
        return batches.length;
    }

    function computeRoot(bytes32 leaf, bytes32[] calldata proof) public pure returns (bytes32 h) {
        h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p
                ? sha256(abi.encodePacked(bytes1(0x01), h, p))
                : sha256(abi.encodePacked(bytes1(0x01), p, h));
        }
    }

    // Doğrulama: VC özeti ve Merkle kanıtı, kayıtlı bir köke ulaşıyor mu, iptal edilmiş mi?
    function verify(bytes32 leaf, bytes32[] calldata proof)
        external
        view
        returns (bool anchored, bool isRevoked, uint256 batchIndex)
    {
        uint256 b = batchOf[computeRoot(leaf, proof)];
        return (b != 0, revokedLeaf[leaf], b == 0 ? 0 : b - 1);
    }
}
