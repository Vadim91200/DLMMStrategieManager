import { Connection, PublicKey, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import DLMM from '@meteora-ag/dlmm'
import { BN } from "@coral-xyz/anchor";
import { getMint, Mint } from "@solana/spl-token";
require('dotenv').config();
export interface BinLiquidity {
    binId: number;
    xAmount: BN;
    yAmount: BN;
    supply: BN;
    version: number;
    price: string;
    pricePerToken: string;
}
export enum PositionVersion {
    V1,
    V2,
}
export enum StrategyType {
    Spot,
    Curve,
    BidAsk,
}
export interface LbPosition {
    publicKey: PublicKey;
    positionData: PositionData;
    version: PositionVersion;
}
export interface PositionBinData {
    binId: number;
    price: string;
    pricePerToken: string;
    binXAmount: string;
    binYAmount: string;
    binLiquidity: string;
    positionLiquidity: string;
    positionXAmount: string;
    positionYAmount: string;
}

export interface PositionData {
    totalXAmount: string;
    totalYAmount: string;
    positionBinData: PositionBinData[];
    lastUpdatedAt: BN;
    upperBinId: number;
    lowerBinId: number;
    feeX: BN;
    feeY: BN;
    rewardOne: BN;
    rewardTwo: BN;
    feeOwner: PublicKey;
    totalClaimedFeeXAmount: BN;
    totalClaimedFeeYAmount: BN;
}

const user = Keypair.fromSecretKey(
    new Uint8Array(bs58.decode(process.env.USER_PRIVATE_KEY!))
);

// Initialize Solana connection
const RPC = process.env.RPC || "https://api.devnet.solana.com";
const connection = new Connection(RPC, "finalized");

const poolAddress = new PublicKey(
    "G7g3bN7Wj1HNPeaxTndGqjmoaq9JMHxvv3QtiGXqBYXi"
);



let activeBin: BinLiquidity;
let baseMint: Mint;
let userPositions: LbPosition[] = [];

const newBalancePosition = new Keypair();
const newImbalancePosition = new Keypair();
const newOneSidePosition = new Keypair();

async function getActiveBin(dlmmPool: DLMM) {
    // Get pool state
    activeBin = await dlmmPool.getActiveBin();
    console.log("🚀 ~ activeBin:", activeBin);
    console.log("ACTIVEBIN FINISHED ");
}

async function getBaseMint(dlmmPool: DLMM) {
    baseMint = await getMint(connection, dlmmPool.tokenX.publicKey);
    console.log("🚀 ~ getBaseMint ~ baseMint:", baseMint);
    console.log("BASEMINT FINISHED ");
}

// To create a balance deposit position
async function createOneSidePosition(dlmmPool: DLMM) {
    const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
    const minBinId = activeBin.binId;
    const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL * 2;
  
    const totalXAmount = new BN(0);
    const totalYAmount = new BN(100 * 10 ** 6);
  
    // Create Position
    const createPositionTx =
      await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newOneSidePosition.publicKey,
        user: user.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: StrategyType.Spot, // can be StrategyType.Spot, StrategyType.BidAsk, StrategyType.Curve
        },
      });
  
    try {
      const createOneSidePositionTxHash = await sendAndConfirmTransaction(
        connection,
        createPositionTx,
        [user, newOneSidePosition]
      );
      console.log(
        "🚀 ~ createOneSidePositionTxHash:",
        createOneSidePositionTxHash
      );
    } catch (error) {
      console.log("🚀 ~ createOneSidePosition::error:", JSON.parse(JSON.stringify(error)));
    }
  }
async function getPositionsState(dlmmPool: DLMM) {
    // Get position state
    const positionsState = await dlmmPool.getPositionsByUserAndLbPair(
        user.publicKey
    );

    userPositions = positionsState.userPositions;
    console.log("🚀 ~ userPositions:", userPositions);
}

async function addLiquidityToExistingPosition(dlmmPool: DLMM) {
    const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
    const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
    const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

    const totalXAmount = new BN(0);
    const totalYAmount = new BN(100 * 10 ** 6);

    // Add Liquidity to existing position
    // Add Liquidity to existing position
  const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
    positionPubKey: newOneSidePosition.publicKey,
    user: user.publicKey,
    totalXAmount,
    totalYAmount,
    strategy: {
      maxBinId,
      minBinId,
      strategyType: StrategyType.Spot, // can be StrategyType.Spot, StrategyType.BidAsk, StrategyType.Curve
    },
  });

  try {
    const addLiquidityTxHash = await sendAndConfirmTransaction(
      connection,
      addLiquidityTx,
      [user]
    );
    console.log("🚀 ~ addLiquidityTxHash:", addLiquidityTxHash);
  } catch (error) {
    console.log("🚀 ~ addLiquidityToExistingPosition::error:", JSON.parse(JSON.stringify(error)));
  }
}

async function removePositionLiquidity(dlmmPool: DLMM) {
    // Remove Liquidity
    const removeLiquidityTxs = (
        await Promise.all(
            userPositions.map(({ publicKey, positionData }) => {
                const binIdsToRemove = positionData.positionBinData.map(
                    (bin) => bin.binId
                );
                return dlmmPool.removeLiquidity({
                    position: publicKey,
                    user: user.publicKey,
                    binIds: binIdsToRemove,
                    bps: new BN(100 * 100),
                    shouldClaimAndClose: true, // should claim swap fee and close position together
                });
            })
        )
    ).flat();

    try {
        for (let tx of removeLiquidityTxs) {
            const removeBalanceLiquidityTxHash = await sendAndConfirmTransaction(
                connection,
                tx,
                [user],
                { skipPreflight: false, preflightCommitment: "confirmed" }
            );
            console.log(
                "🚀 ~ removeBalanceLiquidityTxHash:",
                removeBalanceLiquidityTxHash
            );
        }
    } catch (error) {
        console.log("🚀 ~ removePositionLiquidity::error:", JSON.parse(JSON.stringify(error)));
    }
}

async function swap(dlmmPool: DLMM) {
    const swapAmount = new BN(0.1 * 10 ** 9);
    // Swap quote
    const swapYtoX = true;
    const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);

    const swapQuote = await dlmmPool.swapQuote(swapAmount, swapYtoX, new BN(1), binArrays);

    console.log("🚀 ~ swapQuote:", swapQuote);

    // Swap
    const swapTx = await dlmmPool.swap({
        inToken: dlmmPool.tokenX.publicKey,
        binArraysPubkey: swapQuote.binArraysPubkey,
        inAmount: swapAmount,
        lbPair: dlmmPool.pubkey,
        user: user.publicKey,
        minOutAmount: swapQuote.minOutAmount,
        outToken: dlmmPool.tokenY.publicKey,
    });

    try {
        const swapTxHash = await sendAndConfirmTransaction(connection, swapTx, [
            user,
        ]);
        console.log("🚀 ~ swapTxHash:", swapTxHash);
    } catch (error) {
        console.log("🚀 ~ swap::error:", JSON.parse(JSON.stringify(error)));
    }
}

async function claimFee(dlmmPool: DLMM) {
    const claimFeeTxs = await dlmmPool.claimAllSwapFee({ owner: user.publicKey, positions: userPositions });

    try {
        for (const claimFeeTx of claimFeeTxs) {
            const claimFeeTxHash = await sendAndConfirmTransaction(connection, claimFeeTx, [
                user,
            ]);
            console.log("🚀 ~ claimFeeTxHash:", claimFeeTxHash);
        }
    } catch (error) {
        console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
    }
}

async function main() {
    const dlmmPool = await DLMM.create(connection, poolAddress, {
        cluster: "devnet",
    });
    console.log("Token X", dlmmPool.tokenX.publicKey)
    console.log("Token Y", dlmmPool.tokenY.publicKey)
    await getActiveBin(dlmmPool);
    await getBaseMint(dlmmPool);
    console.log("I will create a position");
    //await createBalancePosition(dlmmPool);
    // await createImbalancePosition(dlmmPool);
    await createOneSidePosition(dlmmPool);
    await getPositionsState(dlmmPool);
    await addLiquidityToExistingPosition(dlmmPool);
    await swap(dlmmPool);
    await claimFee(dlmmPool);
    await removePositionLiquidity(dlmmPool);
}
main().catch(err => {
    console.error(err);
  });