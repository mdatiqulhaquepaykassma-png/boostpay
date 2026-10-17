# Implementation Plan - Remove Keypad and Auth for P2P Transfers

## Goal
The user wants to simplify the P2P transfer process by:
1.  Removing the custom on-screen numeric keypad.
2.  Removing the authentication step (biometric/passkey) for sending money.

## Changes

### `src/components/P2PTransferModal.tsx`
1.  **Remove Keypad Logic**:
    - Remove the `handleKeypadPress` function.
2.  **Update Amount Input**:
    - Change the amount input field from read-only to a standard number input (or keep as text but allow manual entry without the keypad).
    - Remove the keypad grid UI.
3.  **Bypass Authentication**:
    - Remove the `CONFIRM` step entirely.
    - Rename `handleProceedToConfirm` to something like `handleExecuteTransferImmediately` or integrate the transfer logic into the main input form submission.
    - Remove `authMethod` state and `isAuthenticating` state (or simplify it).
4.  **UI Updates**:
    - Update the main form button to directly trigger the transfer.
    - Ensure success state still works.

## Risks & Verification
- **Risks**: Potential for invalid amount inputs if not properly validated. Need to ensure `parseFloat` logic still handles all cases.
- **Verification**: Verify that money can be sent without authentication and without a keypad.
