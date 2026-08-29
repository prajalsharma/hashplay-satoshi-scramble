//! Satoshi Scramble — multi-player token escrow with rank-based settlement.
//!
//! SCRAMBLE_V1 economics (CONFIRMED, frozen): entry per player is fixed by
//! config; pot = entry × joined; 4+ players pay 70/20/10 to ranks 1-3;
//! under 4 players the winner takes 100%; fee 0%. Gameplay happens off-chain
//! on the authoritative realtime server; this program owns ONLY the money:
//! escrow at join, payout at settlement (attested by the pinned settlement
//! authority), and the player-claimable refund escape hatch that guarantees
//! a dead or hostile server can never strand funds. docs/FAIRNESS.md.

use apl_associated_token_account::get_associated_token_address_and_bump_seed;
use arch_program::{
    account::{next_account_info, AccountInfo},
    program::{get_clock, invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::minimum_rent,
    system_instruction,
};
use borsh::{BorshDeserialize, BorshSerialize};

#[cfg(not(feature = "no-entrypoint"))]
arch_program::entrypoint!(process_instruction);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const MAX_PLAYERS: usize = 8;
/// Percent split for 4+ players, ranks 1..3. Remainder-safe: rank 3 gets
/// pot − p1 − p2 so the sum is always exactly the pot.
pub const SPLIT_4PLUS: [u64; 2] = [70, 20];

pub const STATE_OPEN: u8 = 0;
pub const STATE_SETTLED: u8 = 1;
pub const STATE_REFUND: u8 = 2;

/// Only this key may run InitConfig (pinned at build:
/// SCRAMBLE_AUTHORITY=<64-hex> cargo build-sbf). Prevents config squatting.
pub const EXPECTED_AUTHORITY: [u8; 32] = match option_env!("SCRAMBLE_AUTHORITY") {
    Some(_) => parse_authority_hex(),
    None => [
        0xf0, 0xc6, 0x83, 0xb9, 0x9b, 0x7e, 0x0e, 0xba, 0xdc, 0x1c, 0x7d, 0x80, 0x6f, 0xd6,
        0x9a, 0xe2, 0x89, 0xac, 0x69, 0x54, 0x4d, 0xd0, 0xe6, 0xc6, 0x86, 0x48, 0x32, 0xde,
        0x1d, 0x84, 0xcf, 0x3e,
    ],
};

const fn parse_authority_hex() -> [u8; 32] {
    let hex = match option_env!("SCRAMBLE_AUTHORITY") {
        Some(h) => h.as_bytes(),
        None => panic!("unreachable"),
    };
    assert!(hex.len() == 64, "SCRAMBLE_AUTHORITY must be 64 hex chars");
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = nib(hex[i * 2]) * 16 + nib(hex[i * 2 + 1]);
        i += 1;
    }
    out
}

const fn nib(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => panic!("SCRAMBLE_AUTHORITY contains a non-hex character"),
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[repr(u32)]
pub enum ScrambleError {
    AlreadyInitialized = 0,
    NotInitialized = 1,
    BadAuthority = 2,
    BadPda = 3,
    BadMint = 4,
    WrongTokenProgram = 5,
    WrongTokenAccount = 6,
    InvalidConfigValue = 7,
    MatchNotOpen = 8,
    MatchFull = 9,
    JoinDeadlinePassed = 10,
    AlreadyJoined = 11,
    InvalidPlayerCount = 12,
    InvalidRankings = 13,
    DeadlineNotReached = 14,
    NotAPlayer = 15,
    AlreadyClaimed = 16,
    InsufficientVault = 17,
    SettleBlockedByRefund = 18,
}

impl From<ScrambleError> for ProgramError {
    fn from(e: ScrambleError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// PDA ["config"]. LEN 121.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Config {
    pub authority: Pubkey,
    /// The realtime server's attestation key — the only settle/create signer.
    pub settlement_authority: Pubkey,
    pub mint: Pubkey,
    pub entry: u64,
    pub join_timeout_secs: i64,
    pub settle_timeout_secs: i64,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 1; // 121
}

/// PDA ["match", match_id_le]. LEN 333.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Match {
    pub match_id: u64,
    pub entry: u64,
    pub max_players: u8,
    pub joined: u8,
    pub state: u8,
    /// bit i set = players[i] reclaimed their entry.
    pub refund_claimed: u8,
    pub created_at: i64,
    pub join_deadline: i64,
    pub settle_deadline: i64,
    pub players: [Pubkey; MAX_PLAYERS],
    pub result_hash: [u8; 32],
    pub bump: u8,
}

impl Match {
    pub const LEN: usize = 8 + 8 + 1 + 1 + 1 + 1 + 8 + 8 + 8 + 32 * MAX_PLAYERS + 32 + 1; // 333
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum ScrambleInstruction {
    /// [authority(s,w), config(w), mint(r), settlement_authority(r), system]
    InitConfig { entry: u64, join_timeout_secs: i64, settle_timeout_secs: i64 },
    /// [settlement_authority(s,w), config(r), match(w), vault_ata(w), system]
    /// Vault ATA is pre-created (idempotent ATA ix) in the same transaction.
    CreateMatch { match_id: u64, max_players: u8 },
    /// [player(s), config(r), match(w), player_ata(w), vault_ata(w), token(r)]
    JoinMatch,
    /// [settlement_authority(s), config(r), match(w), vault_ata(w), token(r),
    ///  winner ATAs(w) × k]  where k = joined>=4 ? min(3, joined) : 1.
    /// `rankings[0..joined]` = player indices, best first (a permutation).
    SettleMatch { result_hash: [u8; 32], rankings: [u8; 8] },
    /// [player(s), config(r), match(w), vault_ata(w), player_ata(w), token(r)]
    ReclaimEntry,
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

pub fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    data: &[u8],
) -> Result<(), ProgramError> {
    let ix = ScrambleInstruction::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        ScrambleInstruction::InitConfig { entry, join_timeout_secs, settle_timeout_secs } => {
            init_config(program_id, accounts, entry, join_timeout_secs, settle_timeout_secs)
        }
        ScrambleInstruction::CreateMatch { match_id, max_players } => {
            create_match(program_id, accounts, match_id, max_players)
        }
        ScrambleInstruction::JoinMatch => join_match(program_id, accounts),
        ScrambleInstruction::SettleMatch { result_hash, rankings } => {
            settle_match(program_id, accounts, result_hash, rankings)
        }
        ScrambleInstruction::ReclaimEntry => reclaim_entry(program_id, accounts),
    }
}

// ---------------------------------------------------------------------------
// Payout math (pure — unit tested)
// ---------------------------------------------------------------------------

/// Integer-exact SCRAMBLE_V1 split. Sum ALWAYS equals pot.
pub fn payouts(pot: u64, joined: u8) -> Result<Vec<u64>, ProgramError> {
    if joined == 0 {
        return Err(ScrambleError::InvalidPlayerCount.into());
    }
    if joined < 4 {
        return Ok(vec![pot]);
    }
    let p1 = pot
        .checked_mul(SPLIT_4PLUS[0])
        .ok_or(ProgramError::ArithmeticOverflow)? / 100;
    let p2 = pot
        .checked_mul(SPLIT_4PLUS[1])
        .ok_or(ProgramError::ArithmeticOverflow)? / 100;
    let p3 = pot
        .checked_sub(p1)
        .and_then(|r| r.checked_sub(p2))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    Ok(vec![p1, p2, p3])
}

// ---------------------------------------------------------------------------
// 0. InitConfig
// ---------------------------------------------------------------------------

fn init_config<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    entry: u64,
    join_timeout_secs: i64,
    settle_timeout_secs: i64,
) -> Result<(), ProgramError> {
    let it = &mut accounts.iter();
    let authority = next_account_info(it)?;
    let config_info = next_account_info(it)?;
    let mint_info = next_account_info(it)?;
    let settlement_authority = next_account_info(it)?;
    let system_program = next_account_info(it)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if authority.key.serialize() != EXPECTED_AUTHORITY {
        return Err(ScrambleError::BadAuthority.into());
    }
    if entry == 0 || join_timeout_secs <= 0 || settle_timeout_secs <= join_timeout_secs {
        return Err(ScrambleError::InvalidConfigValue.into());
    }
    if mint_info.owner != &apl_token::id() || mint_info.data_is_empty() {
        return Err(ScrambleError::BadMint.into());
    }

    let (expected, bump) = Pubkey::find_program_address(&[b"config"], program_id);
    if config_info.key != &expected {
        return Err(ScrambleError::BadPda.into());
    }
    if !config_info.data_is_empty() {
        return Err(ScrambleError::AlreadyInitialized.into());
    }

    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            config_info.key,
            minimum_rent(Config::LEN),
            Config::LEN as u64,
            program_id,
        ),
        &[authority.clone(), config_info.clone(), system_program.clone()],
        &[&[b"config", &[bump]]],
    )?;

    write_state(config_info, &Config {
        authority: *authority.key,
        settlement_authority: *settlement_authority.key,
        mint: *mint_info.key,
        entry,
        join_timeout_secs,
        settle_timeout_secs,
        bump,
    })
}

// ---------------------------------------------------------------------------
// 1. CreateMatch (settlement authority = the game server)
// ---------------------------------------------------------------------------

fn create_match<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    match_id: u64,
    max_players: u8,
) -> Result<(), ProgramError> {
    let it = &mut accounts.iter();
    let sa = next_account_info(it)?;
    let config_info = next_account_info(it)?;
    let match_info = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let system_program = next_account_info(it)?;

    if !sa.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let config = read_config(program_id, config_info)?;
    if config.settlement_authority != *sa.key {
        return Err(ScrambleError::BadAuthority.into());
    }
    if !(2..=MAX_PLAYERS as u8).contains(&max_players) {
        return Err(ScrambleError::InvalidPlayerCount.into());
    }

    let id_le = match_id.to_le_bytes();
    let (expected, bump) = Pubkey::find_program_address(&[b"match", &id_le], program_id);
    if match_info.key != &expected {
        return Err(ScrambleError::BadPda.into());
    }
    verify_vault(&expected, &config.mint, vault)?;

    invoke_signed(
        &system_instruction::create_account(
            sa.key,
            match_info.key,
            minimum_rent(Match::LEN),
            Match::LEN as u64,
            program_id,
        ),
        &[sa.clone(), match_info.clone(), system_program.clone()],
        &[&[b"match", &id_le, &[bump]]],
    )?;

    let now = get_clock().unix_timestamp;
    write_state(match_info, &Match {
        match_id,
        entry: config.entry,
        max_players,
        joined: 0,
        state: STATE_OPEN,
        refund_claimed: 0,
        created_at: now,
        join_deadline: now.saturating_add(config.join_timeout_secs),
        settle_deadline: now.saturating_add(config.settle_timeout_secs),
        players: [Pubkey::default(); MAX_PLAYERS],
        result_hash: [0; 32],
        bump,
    })
}

// ---------------------------------------------------------------------------
// 2. JoinMatch
// ---------------------------------------------------------------------------

fn join_match<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
) -> Result<(), ProgramError> {
    let it = &mut accounts.iter();
    let player = next_account_info(it)?;
    let config_info = next_account_info(it)?;
    let match_info = next_account_info(it)?;
    let player_ata = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if token_program.key != &apl_token::id() {
        return Err(ScrambleError::WrongTokenProgram.into());
    }
    let config = read_config(program_id, config_info)?;
    let mut m = read_match(program_id, match_info)?;

    // Capacity race is decided by transaction ordering on this account.
    if m.state != STATE_OPEN {
        return Err(ScrambleError::MatchNotOpen.into());
    }
    if m.joined >= m.max_players {
        return Err(ScrambleError::MatchFull.into());
    }
    if get_clock().unix_timestamp > m.join_deadline {
        return Err(ScrambleError::JoinDeadlinePassed.into());
    }
    for i in 0..m.joined as usize {
        if m.players[i] == *player.key {
            return Err(ScrambleError::AlreadyJoined.into());
        }
    }
    verify_vault(match_info.key, &config.mint, vault)?;

    // Entry escrow: fails cleanly on insufficient aBTC.
    token_transfer(player_ata, vault, player, token_program, m.entry, None)?;

    let idx = m.joined as usize;
    m.players[idx] = *player.key;
    m.joined += 1;
    write_state(match_info, &m)
}

// ---------------------------------------------------------------------------
// 3. SettleMatch
// ---------------------------------------------------------------------------

fn settle_match<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    result_hash: [u8; 32],
    rankings: [u8; 8],
) -> Result<(), ProgramError> {
    let it = &mut accounts.iter();
    let sa = next_account_info(it)?;
    let config_info = next_account_info(it)?;
    let match_info = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    if !sa.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if token_program.key != &apl_token::id() {
        return Err(ScrambleError::WrongTokenProgram.into());
    }
    let config = read_config(program_id, config_info)?;
    if config.settlement_authority != *sa.key {
        return Err(ScrambleError::BadAuthority.into());
    }
    let mut m = read_match(program_id, match_info)?;
    // Idempotency + refund guard: settle only from a clean OPEN state.
    if m.state == STATE_REFUND {
        return Err(ScrambleError::SettleBlockedByRefund.into());
    }
    if m.state != STATE_OPEN {
        return Err(ScrambleError::MatchNotOpen.into());
    }
    let joined = m.joined;
    if joined == 0 {
        return Err(ScrambleError::InvalidPlayerCount.into());
    }

    // rankings[0..joined] must be a permutation of 0..joined.
    let mut seen = [false; MAX_PLAYERS];
    for i in 0..joined as usize {
        let r = rankings[i] as usize;
        if r >= joined as usize || seen[r] {
            return Err(ScrambleError::InvalidRankings.into());
        }
        seen[r] = true;
    }

    verify_vault(match_info.key, &config.mint, vault)?;
    let pot = m.entry
        .checked_mul(joined as u64)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let pays = payouts(pot, joined)?;

    let id_le = m.match_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"match", &id_le, &[m.bump]];

    for (k, amount) in pays.iter().enumerate() {
        let winner = m.players[rankings[k] as usize];
        let winner_ata = next_account_info(it)?;
        verify_player_ata(&winner, &config.mint, winner_ata)?;
        if *amount > 0 {
            token_transfer(vault, winner_ata, match_info, token_program, *amount, Some(seeds))?;
        }
    }

    m.result_hash = result_hash;
    m.state = STATE_SETTLED; // terminal — double settlement impossible
    write_state(match_info, &m)
}

// ---------------------------------------------------------------------------
// 4. ReclaimEntry — the escape hatch
// ---------------------------------------------------------------------------

fn reclaim_entry<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
) -> Result<(), ProgramError> {
    let it = &mut accounts.iter();
    let player = next_account_info(it)?;
    let config_info = next_account_info(it)?;
    let match_info = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let player_ata = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if token_program.key != &apl_token::id() {
        return Err(ScrambleError::WrongTokenProgram.into());
    }
    let config = read_config(program_id, config_info)?;
    let mut m = read_match(program_id, match_info)?;

    if m.state == STATE_SETTLED {
        return Err(ScrambleError::MatchNotOpen.into());
    }
    if get_clock().unix_timestamp <= m.settle_deadline {
        return Err(ScrambleError::DeadlineNotReached.into());
    }
    let idx = (0..m.joined as usize)
        .find(|i| m.players[*i] == *player.key)
        .ok_or(ScrambleError::NotAPlayer)?;
    let bit = 1u8 << idx;
    if m.refund_claimed & bit != 0 {
        return Err(ScrambleError::AlreadyClaimed.into());
    }
    verify_vault(match_info.key, &config.mint, vault)?;
    verify_player_ata(player.key, &config.mint, player_ata)?;

    let id_le = m.match_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"match", &id_le, &[m.bump]];
    token_transfer(vault, player_ata, match_info, token_program, m.entry, Some(seeds))?;

    m.refund_claimed |= bit;
    m.state = STATE_REFUND; // blocks any late settlement permanently
    write_state(match_info, &m)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn verify_vault(
    match_pda: &Pubkey,
    mint: &Pubkey,
    vault: &AccountInfo,
) -> Result<(), ProgramError> {
    let (expected, _) = get_associated_token_address_and_bump_seed(
        match_pda, mint, &apl_associated_token_account::id(),
    );
    if vault.key != &expected {
        return Err(ScrambleError::WrongTokenAccount.into());
    }
    if vault.owner != &apl_token::id() {
        return Err(ScrambleError::WrongTokenAccount.into());
    }
    let data = vault.try_borrow_data()?;
    let slice = data.get(..72).ok_or(ScrambleError::WrongTokenAccount)?;
    if &slice[0..32] != mint.as_ref() || &slice[32..64] != match_pda.as_ref() {
        return Err(ScrambleError::WrongTokenAccount.into());
    }
    Ok(())
}

fn verify_player_ata(
    player: &Pubkey,
    mint: &Pubkey,
    ata: &AccountInfo,
) -> Result<(), ProgramError> {
    let (expected, _) = get_associated_token_address_and_bump_seed(
        player, mint, &apl_associated_token_account::id(),
    );
    if ata.key != &expected {
        return Err(ScrambleError::WrongTokenAccount.into());
    }
    Ok(())
}

fn token_transfer<'a>(
    source: &AccountInfo<'a>,
    dest: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    amount: u64,
    signer_seeds: Option<&[&[u8]]>,
) -> Result<(), ProgramError> {
    let ix = apl_token::instruction::transfer(
        &apl_token::id(), source.key, dest.key, authority.key, &[], amount,
    )?;
    let accs = [source.clone(), dest.clone(), authority.clone(), token_program.clone()];
    match signer_seeds {
        Some(seeds) => invoke_signed(&ix, &accs, &[seeds]),
        None => invoke(&ix, &accs),
    }
}

fn read_match(program_id: &Pubkey, info: &AccountInfo) -> Result<Match, ProgramError> {
    if info.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let data = info.try_borrow_data()?;
    let slice = data.get(..Match::LEN).ok_or(ProgramError::InvalidAccountData)?;
    let m = Match::try_from_slice(slice).map_err(|_| ProgramError::InvalidAccountData)?;
    let expected = Pubkey::find_program_address(
        &[b"match", &m.match_id.to_le_bytes()], program_id,
    ).0;
    if info.key != &expected {
        return Err(ScrambleError::BadPda.into());
    }
    Ok(m)
}

fn read_config(program_id: &Pubkey, info: &AccountInfo) -> Result<Config, ProgramError> {
    let (expected, _) = Pubkey::find_program_address(&[b"config"], program_id);
    if info.key != &expected {
        return Err(ScrambleError::BadPda.into());
    }
    if info.owner != program_id || info.data_is_empty() {
        return Err(ScrambleError::NotInitialized.into());
    }
    let data = info.try_borrow_data()?;
    let slice = data.get(..Config::LEN).ok_or(ProgramError::InvalidAccountData)?;
    Config::try_from_slice(slice).map_err(|_| ProgramError::InvalidAccountData)
}

fn write_state<T: BorshSerialize>(account: &AccountInfo, state: &T) -> Result<(), ProgramError> {
    let ser = borsh::to_vec(state).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut data = account.try_borrow_mut_data()?;
    if data.len() < ser.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..ser.len()].copy_from_slice(&ser);
    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payout_math_exact() {
        // 8 × 10,000 = 80,000 → 56,000 / 16,000 / 8,000 (sums exactly)
        assert_eq!(payouts(80_000, 8).unwrap(), vec![56_000, 16_000, 8_000]);
        // 4 × 10,000 = 40,000 → 28,000 / 8,000 / 4,000
        assert_eq!(payouts(40_000, 4).unwrap(), vec![28_000, 8_000, 4_000]);
        // odd pot: remainder goes to rank 3, sum always exact
        let p = payouts(40_001, 5).unwrap();
        assert_eq!(p.iter().sum::<u64>(), 40_001);
        // under 4: winner takes all
        assert_eq!(payouts(30_000, 3).unwrap(), vec![30_000]);
        assert_eq!(payouts(20_000, 2).unwrap(), vec![20_000]);
        assert_eq!(payouts(10_000, 1).unwrap(), vec![10_000]);
        assert!(payouts(0, 0).is_err());
    }

    #[test]
    fn state_sizes_match_borsh() {
        let c = Config {
            authority: Pubkey::default(), settlement_authority: Pubkey::default(),
            mint: Pubkey::default(), entry: 1, join_timeout_secs: 2,
            settle_timeout_secs: 3, bump: 4,
        };
        assert_eq!(borsh::to_vec(&c).unwrap().len(), Config::LEN);

        let m = Match {
            match_id: 1, entry: 2, max_players: 8, joined: 0, state: 0,
            refund_claimed: 0, created_at: 0, join_deadline: 0, settle_deadline: 0,
            players: [Pubkey::default(); MAX_PLAYERS], result_hash: [0; 32], bump: 0,
        };
        assert_eq!(borsh::to_vec(&m).unwrap().len(), Match::LEN);
    }
}
