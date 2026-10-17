import fs from "fs";

const filePath = "src/lib/zcash.ts";
let content = fs.readFileSync(filePath, "utf8");

const target = `        if (totalPaidToTarget >= expectedAmountZec * 0.999) {
          return {
            verified: true,
            actualAmountZec: totalPaidToTarget,
            confirmations,
            blockHeight: rawTx.height,
          };
        } else if (totalPaidToTarget > 0) {
          return {
            verified: false,
            reason: \`UNDERPAID: Transaction paid \${totalPaidToTarget} ZEC to destination, but expected \${expectedAmountZec} ZEC.\`,
            actualAmountZec: totalPaidToTarget,
            confirmations,
          };
        }
      }
    } catch (rpcError: any) {
      // Fall through to shielded check or node check
    }

    // 3. For shielded transactions or wallet-controlled addresses: query z_listreceivedbyaddress
    try {
      const receivedNotes = await this.call<any[]>("z_listreceivedbyaddress", [expectedAddress, minConfirmations]);
      if (Array.isArray(receivedNotes)) {
        const matching = receivedNotes.find((n) => n.txid === txid.trim());
        if (matching) {
          txFoundOnChain = true;
          const confirmations = matching.confirmations || 0;
          if (confirmations < minConfirmations) {
            return {
              verified: false,
              reason: \`INSUFFICIENT_CONFIRMATIONS: Received note has \${confirmations} confirmations (requires at least \${minConfirmations}).\`,
              confirmations,
            };
          }
          if (matching.amount < expectedAmountZec * 0.999) {
            return {
              verified: false,
              reason: \`UNDERPAID: Transaction paid \${matching.amount} ZEC, expected \${expectedAmountZec} ZEC.\`,
              actualAmountZec: matching.amount,
            };
          }
          return {
            verified: true,
            actualAmountZec: matching.amount,
            confirmations,
            blockHeight: matching.blockHeight,
          };
        }
      }
    } catch (e: any) {
      // Fallback handling
    }`;

const replacement = `        if (totalPaidToTarget >= expectedAmountZec * 0.999) {
          return {
            verified: true,
            actualAmountZec: totalPaidToTarget,
            confirmations,
            blockHeight: rawTx.height,
          };
        } else if (totalPaidToTarget > 0) {
          return {
            verified: false,
            reason: \`UNDERPAID: Transaction paid \${totalPaidToTarget} ZEC to destination, but expected \${expectedAmountZec} ZEC.\`,
            actualAmountZec: totalPaidToTarget,
            confirmations,
            blockHeight: rawTx.height,
          };
        }

        // Strategy B: Check Shielded Orchard Actions using local Wasm + Platform UFVK
        if (rawTx.orchard && Array.isArray(rawTx.orchard.actions) && rawTx.orchard.actions.length > 0) {
          let totalShieldedZats = 0;
          let lastDecryptedNote: DecryptedEscrowNote | null = null;

          for (const act of rawTx.orchard.actions) {
            const compactAct: CompactActionInput = {
              nullifier_hex: act.nullifier || act.nullifier_hex || "",
              cmx_hex: act.cmx || act.cmx_hex || "",
              epk_hex: act.ephemeralKey || act.epk || act.epk_hex || "",
              enc_ciphertext_hex: act.encCiphertext || act.enc_ciphertext || act.enc_ciphertext_hex || "",
            };

            if (compactAct.cmx_hex && compactAct.epk_hex && compactAct.enc_ciphertext_hex) {
              const decrypted = await ufvkWatcher.trialDecryptAction(compactAct);
              if (decrypted) {
                totalShieldedZats += decrypted.value_zatoshis;
                lastDecryptedNote = decrypted;
              }
            }
          }

          if (totalShieldedZats > 0) {
            const paidZec = totalShieldedZats / 1e8;
            if (paidZec >= expectedAmountZec * 0.999) {
              return {
                verified: true,
                actualAmountZec: paidZec,
                confirmations,
                blockHeight: rawTx.height,
                memo: lastDecryptedNote?.memo_text,
              };
            } else {
              return {
                verified: false,
                reason: \`UNDERPAID: Transaction paid \${paidZec} ZEC to escrow vault, but expected \${expectedAmountZec} ZEC.\`,
                actualAmountZec: paidZec,
                confirmations,
                blockHeight: rawTx.height,
              };
            }
          }
        }
      }
    } catch (rpcError: any) {
      // Fall through to error diagnostics
    }`;

const normContent = content.replace(/\r\n/g, "\n");
const normTarget = target.replace(/\r\n/g, "\n");

if (!normContent.includes(normTarget)) {
  console.error("Target content not found in normContent!");
  process.exit(1);
}

const updated = normContent.replace(normTarget, replacement);
fs.writeFileSync(filePath, updated, "utf8");
console.log("Successfully patched src/lib/zcash.ts for Phase 4!");
