# Cryptographic signatures for approvals

## What is signed
| Approval | Who | Signed record |
|---|---|---|
| QC inspection: pass, rework or reject (every attempt) | QC inspector, admin | inspection id, roll id and number, roll length, attempt, result, defects (type, severity) |
| Final dispatch confirmation (custody handoff) | Store keeper, admin | dispatch id and number, order number, roll numbers, total length, vehicle number |

The user must accept the statement shown on screen ("I confirm that roll … has passed inspection", …).
A drawn signature can be added as a **handwritten acknowledgment**. It is stored as visual evidence and is
**not** cryptographic proof.

## How a signature is made (one request, one database transaction)
1. **Authenticated**: the JWT is checked and the user is re-read from the database (active, not revoked).
2. **Authorized**: the role is checked by the route, and the business rule by the service (e.g. the roll
   must be awaiting QC, the dispatch must be prepared).
3. **Payload prepared**: canonical JSON (sorted keys) of `{ v, approvalType, statement, entity, record,
   signer {id, name, role}, keyId, signedAt, nonce }`. The nonce is derived from the request's idempotency
   key.
4. **Hashed**: SHA-256 of the payload, stored as `payloadHash`.
5. **Signed**: RSASSA-PSS with SHA-256 (MGF1-SHA-256, salt 32 bytes), using the signer's own private key on
   the server.
6. **Verified**: the new signature is checked with the signer's public key before anything is stored. If
   this fails, the transaction aborts and the approval is not recorded. The failure itself is audited
   separately (`SIGNATURE_VERIFICATION_FAILED`).
7. **Saved**: the signature (algorithm, keyId, payload, hash, signature value, nonce, signer, time) is
   stored with the inspection or dispatch and its audit entry in the same transaction. The API response is
   sent only after commit, and lists these stages.

Replay: a resent request with the same idempotency key replays the stored result, so no second approval
or signature is created. A unique index on the nonce stops any second signature with the same nonce.

## Verification
`GET /api/signatures/:id/verify` (store keeper, floor manager, QC inspector, admin) reports four checks:
- `PAYLOAD_HASH`: SHA-256 of the stored payload equals the stored hash.
- `RSA_SIGNATURE`: the signature verifies with the public key of `keyId`.
- `KEY_OWNER`: that key belongs to the signer named in the payload.
- `RECORD_UNCHANGED`: the inspection or dispatch as stored **now**, rebuilt in the signed shape, equals the
  signed record.

`valid` is true only if all four pass. A failed check is audited (`SIGNATURE_CHECK_FAILED`). Signatures
made before this upgrade are reported as `HANDWRITTEN_ONLY`.

## Keys (managed, per user)
- Each user gets their own RSA key pair (3072-bit by default; `SIGNING_RSA_BITS`), generated on the server
  the first time they sign. `keyId` is the first 16 hex characters of SHA-256 over the public key (SPKI DER).
- The private key is stored only encrypted, with AES-256-GCM under the server's key-encryption key
  `SIGNING_KEY_ENCRYPTION_KEY` (32 random bytes, base64). It is never returned by any API and never sent
  to the browser. Public keys are stored in clear (`GET /api/signatures/keys/me`).
- **Generate** the key-encryption key once per environment:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Put it in the
  environment or secret store, never in Git. The server refuses to start in production without it.
- **Back up** the key-encryption key in the organisation's secret manager, separately from database
  backups. A database backup alone cannot be used to sign.
- **Rotate a user's key** (e.g. a suspected compromise, or a role change): admin,
  `POST /api/signatures/keys/:userId/rotate`. The old key becomes `REVOKED` and is never used again, but
  past signatures remain verifiable because the public key is kept. Audited (`SIGNING_KEY_REVOKED`,
  `SIGNING_KEY_CREATED`).
- **Recovery**: if the key-encryption key is lost, existing private keys cannot be opened. Signing then
  fails safely (`SIGNING_KEY_UNAVAILABLE`, nothing is approved). Configure a new key-encryption key and
  rotate the affected users' keys. Old signatures stay verifiable.
- A deactivated user cannot sign: authentication fails before signing.

## What a signature proves, and what it does not
- **Authentication** establishes which account acted. **Authorization** establishes that the account may
  approve the record. **Key ownership** binds the signature to that account's own key. **Verification**
  proves the stored record is exactly what was signed, and that this account's key signed it.
- It does **not** prove the physical identity of the person at the keyboard. That rests on account security
  (passwords, sessions, devices).
- Because keys are held on the server, an operator with database access **and** the key-encryption key
  could sign. Per-device or hardware-backed keys (WebAuthn, smart cards, an HSM or KMS) would remove that
  trust, and are the recommended next step if non-repudiation against the operator is required.
