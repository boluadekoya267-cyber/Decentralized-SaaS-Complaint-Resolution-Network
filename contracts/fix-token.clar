;; fix-token.clar
;; FixNet Reward Token ($FIX) - SIP-010 Compliant Fungible Token
;; Sophisticated FT with admin controls, multi-minter support, pausing, burning, supply cap,
;; vesting schedules for rewards, delegation for governance, and event emissions.

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-trait-ft-standard.sip-010-trait)

;; Define $FIX token with initial max supply of 1B micro-units (decimals=6, effective 1M tokens)
(define-fungible-token fix-token u1000000000000000)

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-PAUSED u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-RECIPIENT u103)
(define-constant ERR-INVALID-MINTER u104)
(define-constant ERR-ALREADY-REGISTERED u105)
(define-constant ERR-VESTING-NOT-FOUND u106)
(define-constant ERR-VESTING-LOCKED u107)
(define-constant ERR-DELEGATION-ACTIVE u108)
(define-constant ERR-MAX-SUPPLY-REACHED u109)
(define-constant MAX-METADATA-LEN u256)
(define-constant DECIMALS u6)
(define-constant TOKEN-NAME "FixToken")
(define-constant TOKEN-SYMBOL "FIX")

;; Data Variables
(define-data-var contract-admin principal tx-sender)
(define-data-var total-minted uint u0)
(define-data-var contract-paused bool false)
(define-data-var mint-counter uint u0)

;; Data Maps
(define-map balances principal uint)
(define-map minters principal bool)
(define-map mint-records uint {amount: uint, recipient: principal, metadata: (string-utf8 256), timestamp: uint})
(define-map vesting-schedules principal {start-block: uint, duration-blocks: uint, amount: uint, claimed: uint})
(define-map delegations {delegator: principal} {delegatee: principal, until-block: uint})

;; Events (using print for logging in Clarity)
(define-private (emit-event (event-name (string-ascii 32)) (data (buff 1024)))
  (print {event: event-name, data: data}))

;; Read-Only Functions (SIP-010)
(define-read-only (get-name)
  (ok TOKEN-NAME))

(define-read-only (get-symbol)
  (ok TOKEN-SYMBOL))

(define-read-only (get-decimals)
  (ok DECIMALS))

(define-read-only (get-total-supply)
  (ok (var-get total-minted)))

(define-read-only (get-balance (account principal))
  (ok (default-to u0 (map-get? balances account))))

(define-read-only (get-token-uri)
  (ok none))

;; Additional Read-Only
(define-read-only (is-minter (account principal))
  (default-to false (map-get? minters account)))

(define-read-only (is-paused)
  (var-get contract-paused))

(define-read-only (get-mint-record (mint-id uint))
  (map-get? mint-records mint-id))

(define-read-only (get-vesting-schedule (account principal))
  (map-get? vesting-schedules account))

(define-read-only (get-delegation (delegator principal))
  (map-get? delegations {delegator: delegator}))

(define-read-only (get-effective-balance (account principal))
  (let ((base-balance (unwrap-panic (get-balance account)))
        (vesting (get-vesting-schedule account))
        (current-block (block-height))
        (delegation (get-delegation account)))
    (if (is-some vesting)
      (let ((vest-data (unwrap-panic vesting))
            (vested-amount (/ (* (- current-block (get start-block vest-data)) (get amount vest-data)) (get duration-blocks vest-data))))
        (+ base-balance (- vested-amount (get claimed vest-data))))
      base-balance)))

;; Public Functions
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-eq tx-sender sender) (err ERR-UNAUTHORIZED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (not (is-eq recipient sender)) (err ERR-INVALID-RECIPIENT))
    (try! (ft-transfer? fix-token amount sender recipient))
    (emit-event "transfer" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? sender)) (concat (unwrap-panic (to-consensus-buff? recipient)) (unwrap-panic (to-consensus-buff? amount)))) u1024)))
    (ok true)))

(define-public (mint (amount uint) (recipient principal) (metadata (string-utf8 256)))
  (let ((new-total (+ (var-get total-minted) amount))
        (checked-recipient (unwrap-panic (ok recipient)))
        (checked-amount (unwrap-panic (ok amount))))
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-minter tx-sender) (err ERR-INVALID-MINTER))
    (asserts! (> checked-amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (<= (len metadata) MAX-METADATA-LEN) (err ERR-INVALID-AMOUNT)) ;; Reusing error for simplicity
    (asserts! (<= new-total u1000000000000000) (err ERR-MAX-SUPPLY-REACHED))
    (try! (ft-mint? fix-token checked-amount checked-recipient))
    (map-set balances checked-recipient (+ (default-to u0 (map-get? balances checked-recipient)) checked-amount))
    (let ((mint-id (+ (var-get mint-counter) u1)))
      (map-set mint-records mint-id {amount: checked-amount, recipient: checked-recipient, metadata: metadata, timestamp: (block-height)})
      (var-set mint-counter mint-id))
    (var-set total-minted new-total)
    (emit-event "mint" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? tx-sender)) (concat (unwrap-panic (to-consensus-buff? checked-recipient)) (concat (unwrap-panic (to-consensus-buff? checked-amount)) (unwrap-panic (to-consensus-buff? metadata))))) u1024)))
    (ok true)))

(define-public (burn (amount uint))
  (begin
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (try! (ft-burn? fix-token amount tx-sender))
    (map-set balances tx-sender (- (default-to u0 (map-get? balances tx-sender)) amount))
    (var-set total-minted (- (var-get total-minted) amount))
    (emit-event "burn" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? tx-sender)) (unwrap-panic (to-consensus-buff? amount))) u1024)))
    (ok true)))

(define-public (add-minter (new-minter principal))
  (let ((checked-new-minter (unwrap-panic (ok new-minter))))
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (asserts! (not (is-minter checked-new-minter)) (err ERR-ALREADY-REGISTERED))
    (map-set minters checked-new-minter true)
    (emit-event "add-minter" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? tx-sender)) (unwrap-panic (to-consensus-buff? checked-new-minter))) u1024)))
    (ok true)))

(define-public (remove-minter (minter principal))
  (let ((checked-minter (unwrap-panic (ok minter))))
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (map-set minters checked-minter false)
    (emit-event "remove-minter" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? tx-sender)) (unwrap-panic (to-consensus-buff? checked-minter))) u1024)))
    (ok true)))

(define-public (pause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-paused true)
    (emit-event "pause" (unwrap-panic (to-consensus-buff? tx-sender)))
    (ok true)))

(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-paused false)
    (emit-event "unpause" (unwrap-panic (to-consensus-buff? tx-sender)))
    (ok true)))

(define-public (set-admin (new-admin principal))
  (let ((checked-new-admin (unwrap-panic (ok new-admin))))
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-admin checked-new-admin)
    (emit-event "set-admin" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? tx-sender)) (unwrap-panic (to-consensus-buff? checked-new-admin))) u1024)))
    (ok true)))

(define-public (set-vesting-schedule (recipient principal) (start-block uint) (duration-blocks uint) (amount uint))
  (let ((checked-recipient (unwrap-panic (ok recipient)))
        (checked-start-block (unwrap-panic (ok start-block)))
        (checked-duration-blocks (unwrap-panic (ok duration-blocks)))
        (checked-amount (unwrap-panic (ok amount))))
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (asserts! (> checked-duration-blocks u0) (err ERR-INVALID-AMOUNT))
    (asserts! (> checked-amount u0) (err ERR-INVALID-AMOUNT))
    (map-set vesting-schedules checked-recipient {start-block: checked-start-block, duration-blocks: checked-duration-blocks, amount: checked-amount, claimed: u0})
    (emit-event "set-vesting" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? checked-recipient)) (concat (unwrap-panic (to-consensus-buff? checked-amount)) (unwrap-panic (to-consensus-buff? checked-duration-blocks)))) u1024)))
    (ok true)))

(define-public (claim-vesting)
  (let ((vesting (unwrap! (get-vesting-schedule tx-sender) (err ERR-VESTING-NOT-FOUND)))
        (current-block (block-height))
        (vested-amount (/ (* (- current-block (get start-block vesting)) (get amount vesting)) (get duration-blocks vesting)))
        (claimable (- vested-amount (get claimed vesting))))
    (asserts! (> claimable u0) (err ERR-VESTING-LOCKED))
    (try! (transfer claimable (var-get contract-admin) tx-sender none)) ;; Assuming admin holds vested tokens
    (map-set vesting-schedules tx-sender (merge vesting {claimed: (+ (get claimed vesting) claimable)}))
    (emit-event "claim-vesting" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? tx-sender)) (unwrap-panic (to-consensus-buff? claimable))) u1024)))
    (ok claimable)))

(define-public (delegate (delegatee principal) (until-block uint))
  (let ((checked-delegatee (unwrap-panic (ok delegatee)))
        (checked-until-block (unwrap-panic (ok until-block))))
    (asserts! (> checked-until-block (block-height)) (err ERR-INVALID-AMOUNT))
    (asserts! (is-none (get-delegation tx-sender)) (err ERR-DELEGATION-ACTIVE))
    (map-set delegations {delegator: tx-sender} {delegatee: checked-delegatee, until-block: checked-until-block})
    (emit-event "delegate" (unwrap-panic (as-max-len? (concat (unwrap-panic (to-consensus-buff? tx-sender)) (concat (unwrap-panic (to-consensus-buff? checked-delegatee)) (unwrap-panic (to-consensus-buff? checked-until-block)))) u1024)))
    (ok true)))

(define-public (revoke-delegation)
  (let ((delegation (unwrap! (get-delegation tx-sender) (err ERR-VESTING-NOT-FOUND))))
    (map-delete delegations {delegator: tx-sender})
    (emit-event "revoke-delegation" (unwrap-panic (to-consensus-buff? tx-sender)))
    (ok true)))

;; Initialization - Add deployer as initial minter
(begin
  (map-set minters tx-sender true))