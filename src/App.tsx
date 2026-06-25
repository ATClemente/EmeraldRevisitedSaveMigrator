import { useState, useRef } from 'react'
import './App.css'

type Sector = {
  physicalIndex: number;
  id: number;
  checksum: number;
  signature: number;
  counter: number;
  bytes: Uint8Array<ArrayBuffer>;
}

type Slot = {
  slotIndex: number;
  counter: number;
  sectorsById: Map<number, Sector>;
}

type Layout = {
    saveBlock1Size: number,
    saveBlock2Size: number,
    saveBlock1Seen1Offset: number,
    saveBlock1Seen2Offset: number,
    dexNavSearchLevelsOffset: number,
    dexNavChainOffset: number,
    saveBlock2PokedexOffset: number,
    pokedexOwnedOffset: number,
    pokedexSeenOffset: number,
    pokedexSize: number,
}

function App() {
  const [retainFileName, setRetainFileName] = useState(false);
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const textareaRef = useRef(null);

  const SECTOR_DATA_SIZE = 3968;
  const SECTOR_SIZE = 4096;
  const SECTORS_PER_SLOT = 14;
  const SLOT_SIZE = SECTOR_SIZE * SECTORS_PER_SLOT;
  const RAW_SAVE_SIZE = SECTOR_SIZE * 32;
  const SAVE_SIGNATURE = 0x08012025;

  const SECTOR_ID_SAVEBLOCK2 = 0;
  const SECTOR_ID_SAVEBLOCK1_START = 1;
  const SECTOR_ID_SAVEBLOCK1_END = 4;
  const SECTOR_ID_PKMN_STORAGE_START = 5;
  const SECTOR_ID_PKMN_STORAGE_END = 13;

  const OLD_LAYOUT = {
    saveBlock1Size: 15816,
    saveBlock2Size: 3884,
    saveBlock1Seen1Offset: 2680,
    saveBlock1Seen2Offset: 14996,
    dexNavSearchLevelsOffset: 15400,
    dexNavChainOffset: 15812,
    saveBlock2PokedexOffset: 24,
    pokedexOwnedOffset: 16,
    pokedexSeenOffset: 68,
    pokedexSize: 120,
  };

  const OLD_NUM_SPECIES = 412;
  const NEW_NUM_SPECIES = 447;

  const OLD_DEX_FLAG_BYTES = roundBitsToBytes(OLD_NUM_SPECIES);
  const NEW_DEX_FLAG_BYTES = roundBitsToBytes(NEW_NUM_SPECIES);

  const NEW_LAYOUT = {
    saveBlock1Size: 15856,
    saveBlock2Size: 3892,
    saveBlock1Seen1Offset: 2680,
    saveBlock1Seen2Offset: 15000,
    dexNavSearchLevelsOffset: 15408,
    dexNavChainOffset: 15855,
    saveBlock2PokedexOffset: 24,
    pokedexOwnedOffset: 16,
    pokedexSeenOffset: 72,
    pokedexSize: 128,
  };

  // Sizes used by src/save.c's sSaveSlotLayout. Checksums are computed over
  // each logical sector's actual chunk size, not always the full data area.
  const OLD_SAVE_SECTOR_DATA_SIZES = makeSaveSectorDataSizes(OLD_LAYOUT);
  const NEW_SAVE_SECTOR_DATA_SIZES = makeSaveSectorDataSizes(NEW_LAYOUT);

  const SECTOR_FOOTER_USED_SIZE = 12;
  const SECTOR_FOOTER_USED_OFFSET = SECTOR_SIZE - SECTOR_FOOTER_USED_SIZE;
  const SECTION_ID_OFFSET = SECTOR_FOOTER_USED_OFFSET + 0x00; // 4084 / 0xFF4
  const CHECKSUM_OFFSET   = SECTOR_FOOTER_USED_OFFSET + 0x02; // 4086 / 0xFF6
  const SIGNATURE_OFFSET  = SECTOR_FOOTER_USED_OFFSET + 0x04; // 4088 / 0xFF8
  const COUNTER_OFFSET    = SECTOR_FOOTER_USED_OFFSET + 0x08; // 4092 / 0xFFC

  return (
    <>
      <section id="center">
        <div>
          <h1>Pokemon Emerald Revisited Save Migration</h1>
          <p>
            The addition of new Pokemon species in version 2.0 makes previous saves incompatible unless converted.
            If you do not want to start a new file you must convert old saves. To be safe make sure that the save is from v1.1.
            If your save is from an older version, load it in v1.1 and save. Then you are ready to migrate.
            Check the box below if you would like the downloaded file to keep its name.
          </p>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          onChange={(event) => {setSelectedFile(event?.target?.files?.[0] || null)}}
          //style={{ display: 'none' }}
          //accept="image/*,.pdf" // Optional: restrict to specific formats
        />
        <button
          type="button"
          disabled={!selectedFile}
          className="counter"
          onClick={processSaveFile}
        >
          Convert
        </button>

        <span style={{display: 'flex'}}>
          <input
            type="checkbox"
            checked={retainFileName}
            onChange={(event) => setRetainFileName(event.target.checked)}
          />
          <p style={{marginLeft: 5}}>Preserve file name?</p>
        </span>

        <div style={{ marginTop: '10px', width: '100%' }}>
          <textarea
            ref={textareaRef}
            value={logs.join('\n')}
            readOnly
            rows={15}
            style={{
              width: '90%',
              backgroundColor: '#1e1e1e',
              color: '#ffffff',
              padding: '10px',
              fontSize: '14px',
              resize: 'none',
              fontFamily: 'monospace'
            }}
          />
        </div>

        <a style={{marginBottom: 5}} href="https://discord.gg/75MaRJXGtH">Discord</a>
      </section>
    </>
  );

  function addLog(log: string) {
    setLogs((prevLogs) => [...prevLogs, log]);
  }

  async function processSaveFile() {
    setLogs([]);
    console.log("Processing save file");
    addLog("Processing save file");

    if(!!selectedFile) {
      const fileBytes = new Uint8Array(await selectedFile.bytes());

      //Process save/////////////////////////////////////////////
      const OLD_SPECIES_NUM = 412;
      const NEW_SPECIES_TO_ADD = 35;

      const rawSaveOffset = detectRawSaveOffset(fileBytes);
      const bytes = fileBytes.slice(rawSaveOffset, rawSaveOffset + RAW_SAVE_SIZE);
      debugScanSectors(bytes);

      const slot = pickLatestValidSlot(bytes);

      const saveBlock2 = extractSaveBlock2(slot);
      const saveBlock1 = extractSaveBlock1(slot);

      const newSaveBlock2 = migrateSaveBlock2(saveBlock2);
      const newSaveBlock1 = migrateSaveBlock1(saveBlock1);
      verifyMigratedBlocks(saveBlock2, saveBlock1, newSaveBlock2, newSaveBlock1);
      console.log("Migrated block contents verified.");
      addLog("Migrated block contents verified.");

      writeBlockToSectors(slot, 0, 0, newSaveBlock2, NEW_SAVE_SECTOR_DATA_SIZES);
      writeBlockToSectors(slot, 1, 4, newSaveBlock1, NEW_SAVE_SECTOR_DATA_SIZES);

      writeSlotBackToSave(bytes, slot);

      const migratedSlot = parseSlot(bytes, slot.slotIndex, NEW_SAVE_SECTOR_DATA_SIZES);
      if (!migratedSlot) {
          addLog("ERROR!!! Migrated slot failed new-layout checksum validation.")
          throw new Error("Migrated slot failed new-layout checksum validation.");
      }
      console.log("Migrated slot validates with new layout checksums.");
      addLog("Migrated slot validates with new layout checksums.");

      const outputBytes = new Uint8Array(fileBytes);
      outputBytes.set(bytes, rawSaveOffset);

      ////////////////////////////////////////////////////////////

      
      const blob = new Blob([outputBytes]);
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        retainFileName ? selectedFile.name : `new.sav`,
      );

      // Append to html link element page
      document.body.appendChild(link);

      // Start download
      link.click();

      // Clean up and remove the link
      link.parentNode?.removeChild(link);
    }
  }

  function roundBitsToBytes(bits: number) {
    return Math.floor((bits + 7) / 8);
  }

  function chunkSize(totalSize: number, chunkIndex: number) {
    const offset = chunkIndex * SECTOR_DATA_SIZE;
    return Math.max(0, Math.min(totalSize - offset, SECTOR_DATA_SIZE));
  }

  function makeSaveSectorDataSizes(layout: Layout) {
    return [
      chunkSize(layout.saveBlock2Size, 0),

      chunkSize(layout.saveBlock1Size, 0),
      chunkSize(layout.saveBlock1Size, 1),
      chunkSize(layout.saveBlock1Size, 2),
      chunkSize(layout.saveBlock1Size, 3),

      // PokemonStorage is unchanged by this migration.
      0xF80,
      0xF80,
      0xF80,
      0xF80,
      0xF80,
      0xF80,
      0xF80,
      0xF80,
      0x7D0,
    ];
  }


  function setU16(bytes: Uint8Array<ArrayBuffer>, offset: number, value: number) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .setUint16(offset, value, true);
  }

  function makeView(bytes: Uint8Array<ArrayBuffer>) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function getU16(bytes: Uint8Array<ArrayBuffer>, offset: number) {
    return makeView(bytes).getUint16(offset, true);
  }

  function getU32(bytes: Uint8Array<ArrayBuffer>, offset: number) {
    return makeView(bytes).getUint32(offset, true);
  }

  function calcChecksum(data: Uint8Array<ArrayBuffer>, size: number) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let checksum = 0;

    for (let i = 0; i < size; i += 4) {
      checksum = (checksum + view.getUint32(i, true)) >>> 0;
    }

    return ((checksum >>> 16) + checksum) & 0xffff;
  }

  function findChecksumSizes(data: Uint8Array<ArrayBuffer>, expectedChecksum: number) {
    const matches = [];

    for (let size = 0; size <= SECTOR_DATA_SIZE; size += 4) {
      if (calcChecksum(data, size) === expectedChecksum) {
        matches.push(size);
      }
    }

    return matches;
  }

  function parseSector(slotBytes: Uint8Array<ArrayBuffer>, physicalIndex: number) {
    const start = physicalIndex * SECTOR_SIZE;
    const sector = slotBytes.slice(start, start + SECTOR_SIZE);

    const id = getU16(sector, SECTION_ID_OFFSET);
    const checksum = getU16(sector, CHECKSUM_OFFSET);
    const signature = getU32(sector, SIGNATURE_OFFSET);
    const counter = getU32(sector, COUNTER_OFFSET);

    return {
      physicalIndex,
      id,
      checksum,
      signature,
      counter,
      bytes: sector,
    };
  }

  function parseSlot(saveBytes: Uint8Array<ArrayBuffer>, slotIndex: number, sectorDataSizes = OLD_SAVE_SECTOR_DATA_SIZES): Slot | null {
    const slotStart = slotIndex * SLOT_SIZE;
    const slotBytes = saveBytes.slice(slotStart, slotStart + SLOT_SIZE);

    if (slotBytes.length < SLOT_SIZE) {
      console.warn(`slot ${slotIndex}: too short (${slotBytes.length} bytes)`);
      return null;
    }

    const sectorsById = new Map();
    let maxCounter = 0;

    for (let physicalIndex = 0; physicalIndex < SECTORS_PER_SLOT; physicalIndex++) {
      const sector = parseSector(slotBytes, physicalIndex);

      if (sector.signature !== SAVE_SIGNATURE) {
        console.warn(
          `slot ${slotIndex}, physical sector ${physicalIndex}: bad signature ` +
          `0x${sector.signature.toString(16)}`
        );
        continue;
      }

      if (sector.id < 0 || sector.id >= SECTORS_PER_SLOT) {
        console.warn(
          `slot ${slotIndex}, physical sector ${physicalIndex}: bad logical id ${sector.id}`
        );
        continue;
      }

      const data = sector.bytes.slice(0, SECTOR_DATA_SIZE);
      const checksumSize = sectorDataSizes[sector.id];
      const actualChecksum = calcChecksum(data, checksumSize);
      if (actualChecksum !== sector.checksum) {
        const matchingSizes = findChecksumSizes(data, sector.checksum);
        console.warn(
          `slot ${slotIndex}, physical sector ${physicalIndex}, logical sector ${sector.id}: ` +
          `bad checksum stored=0x${sector.checksum.toString(16)} ` +
          `actual=0x${actualChecksum.toString(16)} size=0x${checksumSize.toString(16)} ` +
          `matchingSizes=${matchingSizes.map(size => `0x${size.toString(16)}`).join(",")}`
        );
        continue;
      }

      if (sectorsById.has(sector.id)) {
        console.warn(
          `slot ${slotIndex}, physical sector ${physicalIndex}: duplicate logical id ${sector.id}`
        );
        continue;
      }

      sectorsById.set(sector.id, sector);
      maxCounter = Math.max(maxCounter, sector.counter);
    }

    for (let id = 0; id < SECTORS_PER_SLOT; id++) {
      if (!sectorsById.has(id)) {
        console.warn(`slot ${slotIndex}: missing logical sector ${id}`);
        return null;
      }
    }

    return {
      slotIndex,
      counter: maxCounter,
      sectorsById,
    };
  }

  function pickLatestValidSlot(saveBytes: Uint8Array<ArrayBuffer>) {
    const slots = [parseSlot(saveBytes, 0), parseSlot(saveBytes, 1)]
      .filter(Boolean);

    if (slots.length === 0) {
      addLog("ERROR!!! No valid save slot found.");
      throw new Error("No valid save slot found.");
    }

    return slots.filter(x => x != null).reduce((best, slot) =>
      slot.counter > best.counter ? slot : best
    );
  }

  function debugScanSectors(saveBytes: Uint8Array<ArrayBuffer>) {
    console.log(`save file size: ${saveBytes.length} bytes`);
    addLog(`save file size: ${saveBytes.length} bytes`);

    const sectorCount = Math.floor(saveBytes.length / SECTOR_SIZE);
    for (let physicalSector = 0; physicalSector < sectorCount; physicalSector++) {
      const start = physicalSector * SECTOR_SIZE;
      const sector = saveBytes.slice(start, start + SECTOR_SIZE);
      const signature = getU32(sector, SIGNATURE_OFFSET);

      if (signature === SAVE_SIGNATURE) {
        const id = getU16(sector, SECTION_ID_OFFSET);
        const checksum = getU16(sector, CHECKSUM_OFFSET);
        const counter = getU32(sector, COUNTER_OFFSET);
        console.log(
          `physical sector ${physicalSector}: id=${id} ` +
          `checksum=0x${checksum.toString(16)} counter=${counter}`
        );
        addLog(`physical sector ${physicalSector}: id=${id} ` +
          `checksum=0x${checksum.toString(16)} counter=${counter}`);
      }
    }
  }

  function countSectorSignatures(saveBytes: Uint8Array<ArrayBuffer>, baseOffset: number) {
    let count = 0;
    const maxSectors = Math.floor((saveBytes.length - baseOffset) / SECTOR_SIZE);

    for (let physicalSector = 0; physicalSector < maxSectors; physicalSector++) {
      const start = baseOffset + physicalSector * SECTOR_SIZE;
      const sector = saveBytes.slice(start, start + SECTOR_SIZE);

      if (getU32(sector, SIGNATURE_OFFSET) === SAVE_SIGNATURE) {
        count++;
      }
    }

    return count;
  }

  function detectRawSaveOffset(saveBytes: Uint8Array<ArrayBuffer>) {
    const candidates = [0];
    const extraBytes = saveBytes.length - RAW_SAVE_SIZE;

    if (extraBytes > 0 && extraBytes < SECTOR_SIZE) {
      candidates.push(extraBytes);
    }

    for (let offset = 1; offset < 32; offset++) {
      if (!candidates.includes(offset)) {
        candidates.push(offset);
      }
    }

    let bestOffset = 0;
    let bestCount = -1;

    for (const offset of candidates) {
      if (saveBytes.length - offset < RAW_SAVE_SIZE) {
        continue;
      }

      const count = countSectorSignatures(saveBytes, offset);
      if (count > bestCount) {
        bestOffset = offset;
        bestCount = count;
      }
    }

    if (bestCount === 0) {
      const signatureOffsets = findSignatureOffsets(saveBytes);
      console.log(
        `found ${signatureOffsets.length} raw signature byte pattern(s) in file`
      );
      addLog(`found ${signatureOffsets.length} raw signature byte pattern(s) in file`);
      if (signatureOffsets.length > 0) {
        console.log(
          `first signature offsets: ${signatureOffsets.slice(0, 16).join(", ")}`
        );
        addLog(`first signature offsets: ${signatureOffsets.slice(0, 16).join(", ")}`);
      }

      addLog("ERROR!!! Could not find any Emerald save sector signatures.");
      throw new Error("Could not find any Emerald save sector signatures.");
    }

    if (bestOffset !== 0) {
      addLog(`detected raw save data at byte offset ${bestOffset}`);
      console.log(`detected raw save data at byte offset ${bestOffset}`);
    }

    return bestOffset;
  }

  function findSignatureOffsets(saveBytes: Uint8Array<ArrayBuffer>) {
    const offsets = [];

    // SAVE_SIGNATURE 0x08012025 as little-endian bytes.
    for (let i = 0; i <= saveBytes.length - 4; i++) {
      if (
        saveBytes[i] === 0x25 &&
        saveBytes[i + 1] === 0x20 &&
        saveBytes[i + 2] === 0x01 &&
        saveBytes[i + 3] === 0x08
      ) {
        offsets.push(i);
      }
    }

    return offsets;
  }

  function extractBlock(slot: Slot, startId: number, endId: number) {
    const chunks = [];

    for (let id = startId; id <= endId; id++) {
      const sector = slot.sectorsById.get(id);
      if (!!sector) {
        chunks.push(sector.bytes.slice(0, SECTOR_DATA_SIZE));
      }
    }

    const totalSize = chunks.length * SECTOR_DATA_SIZE;
    const block = new Uint8Array(totalSize);

    let offset = 0;
    for (const chunk of chunks) {
      block.set(chunk, offset);
      offset += chunk.length;
    }

    return block;
  }

  function extractSaveBlock2(slot: Slot) {
    return extractBlock(slot, 0, 0);
  }

  function extractSaveBlock1(slot: Slot) {
    return extractBlock(slot, 1, 4);
  }

  function extractPokemonStorage(slot: Slot) {
    return extractBlock(slot, 5, 13);
  }

  function readLayoutFromRom(romBytes: Uint8Array<ArrayBuffer>) {
    const magic = [0x59, 0x41, 0x4C, 0x53]; // 0x534C4159 little endian

    for (let i = 0; i <= romBytes.length - 4; i += 4) {
      if (
        romBytes[i] === magic[0] &&
        romBytes[i + 1] === magic[1] &&
        romBytes[i + 2] === magic[2] &&
        romBytes[i + 3] === magic[3]
      ) {
        const view = new DataView(romBytes.buffer, romBytes.byteOffset, romBytes.byteLength);

        return {
          saveBlock1Size: view.getUint32(i + 4, true),
          saveBlock2Size: view.getUint32(i + 8, true),
          saveBlock1Seen1Offset: view.getUint32(i + 12, true),
          saveBlock1Seen2Offset: view.getUint32(i + 16, true),
          dexNavSearchLevelsOffset: view.getUint32(i + 20, true),
          dexNavChainOffset: view.getUint32(i + 24, true),
          saveBlock2PokedexOffset: view.getUint32(i + 28, true),
          pokedexOwnedOffset: view.getUint32(i + 32, true),
          pokedexSeenOffset: view.getUint32(i + 36, true),
          pokedexSize: view.getUint32(i + 40, true),
        };
      }
    }

    addLog("ERROR!!! Save layout table not found in ROM.");
    throw new Error("Save layout table not found in ROM.");
  }

  function copyExpandedArray({
    oldBlock,
    newBlock,
    oldOffset,
    oldLength,
    newOffset,
    newLength,
  }: {
    oldBlock: Uint8Array<ArrayBuffer>,
    newBlock: Uint8Array<ArrayBuffer>,
    oldOffset: number,
    oldLength: number,
    newOffset: number,
    newLength: number,
  }) {
    newBlock.set(
      oldBlock.slice(oldOffset, oldOffset + oldLength),
      newOffset
    );

    // New Uint8Array starts zeroed, so the expanded tail is already 0.
  }

  function allZero(bytes: Uint8Array<ArrayBuffer>) {
    return bytes.every(byte => byte === 0);
  }

  function assertBytesEqual(actual: Uint8Array<ArrayBuffer>, expected: Uint8Array<ArrayBuffer>, label: string) {
    if (actual.length !== expected.length) {
      addLog(`ERROR!!! ${label}: length mismatch ${actual.length} !== ${expected.length}`);
      throw new Error(`${label}: length mismatch ${actual.length} !== ${expected.length}`);
    }

    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) {
        addLog(`ERROR!!! ${label}: mismatch at +0x${i.toString(16)}`);
        throw new Error(`${label}: mismatch at +0x${i.toString(16)}`);
      }
    }
  }

  function assertExpandedArray({
    oldBlock,
    newBlock,
    oldOffset,
    oldLength,
    newOffset,
    newLength,
    label,
  }: {
    oldBlock: Uint8Array<ArrayBuffer>,
    newBlock: Uint8Array<ArrayBuffer>,
    oldOffset: number,
    oldLength: number,
    newOffset: number,
    newLength: number,
    label: string,
  }) {
    assertBytesEqual(
      newBlock.slice(newOffset, newOffset + oldLength),
      oldBlock.slice(oldOffset, oldOffset + oldLength),
      `${label} preserved`
    );

    if (!allZero(newBlock.slice(newOffset + oldLength, newOffset + newLength))) {
      addLog(`ERROR!!! ${label} expansion bytes are not zero`);
      throw new Error(`${label} expansion bytes are not zero`);
    }
  }

  function verifyMigratedBlocks(oldSaveBlock2: Uint8Array<ArrayBuffer>, oldSaveBlock1: Uint8Array<ArrayBuffer>, newSaveBlock2: Uint8Array<ArrayBuffer>, newSaveBlock1: Uint8Array<ArrayBuffer>) {
    const oldOwnedOffset = OLD_LAYOUT.saveBlock2PokedexOffset + OLD_LAYOUT.pokedexOwnedOffset;
    const oldSeenOffset = OLD_LAYOUT.saveBlock2PokedexOffset + OLD_LAYOUT.pokedexSeenOffset;
    const newOwnedOffset = NEW_LAYOUT.saveBlock2PokedexOffset + NEW_LAYOUT.pokedexOwnedOffset;
    const newSeenOffset = NEW_LAYOUT.saveBlock2PokedexOffset + NEW_LAYOUT.pokedexSeenOffset;

    assertExpandedArray({
      oldBlock: oldSaveBlock2,
      newBlock: newSaveBlock2,
      oldOffset: oldOwnedOffset,
      oldLength: OLD_DEX_FLAG_BYTES,
      newOffset: newOwnedOffset,
      newLength: NEW_DEX_FLAG_BYTES,
      label: "SaveBlock2 pokedex.owned",
    });

    assertExpandedArray({
      oldBlock: oldSaveBlock2,
      newBlock: newSaveBlock2,
      oldOffset: oldSeenOffset,
      oldLength: OLD_DEX_FLAG_BYTES,
      newOffset: newSeenOffset,
      newLength: NEW_DEX_FLAG_BYTES,
      label: "SaveBlock2 pokedex.seen",
    });

    assertExpandedArray({
      oldBlock: oldSaveBlock1,
      newBlock: newSaveBlock1,
      oldOffset: OLD_LAYOUT.saveBlock1Seen1Offset,
      oldLength: OLD_DEX_FLAG_BYTES,
      newOffset: NEW_LAYOUT.saveBlock1Seen1Offset,
      newLength: NEW_DEX_FLAG_BYTES,
      label: "SaveBlock1 seen1",
    });

    assertExpandedArray({
      oldBlock: oldSaveBlock1,
      newBlock: newSaveBlock1,
      oldOffset: OLD_LAYOUT.saveBlock1Seen2Offset,
      oldLength: OLD_DEX_FLAG_BYTES,
      newOffset: NEW_LAYOUT.saveBlock1Seen2Offset,
      newLength: NEW_DEX_FLAG_BYTES,
      label: "SaveBlock1 seen2",
    });

    assertExpandedArray({
      oldBlock: oldSaveBlock1,
      newBlock: newSaveBlock1,
      oldOffset: OLD_LAYOUT.dexNavSearchLevelsOffset,
      oldLength: OLD_NUM_SPECIES,
      newOffset: NEW_LAYOUT.dexNavSearchLevelsOffset,
      newLength: NEW_NUM_SPECIES,
      label: "SaveBlock1 dexNavSearchLevels",
    });

    if (oldSaveBlock1[OLD_LAYOUT.dexNavChainOffset] !== newSaveBlock1[NEW_LAYOUT.dexNavChainOffset]) {
      addLog("ERROR!!! SaveBlock1 dexNavChain was not preserved");
      throw new Error("SaveBlock1 dexNavChain was not preserved");
    }
  }

  function migrateSaveBlock2(oldBlock: Uint8Array<ArrayBuffer>) {
    const oldOwnedOffset = OLD_LAYOUT.saveBlock2PokedexOffset + OLD_LAYOUT.pokedexOwnedOffset;
    const oldSeenOffset = OLD_LAYOUT.saveBlock2PokedexOffset + OLD_LAYOUT.pokedexSeenOffset;

    const newOwnedOffset = NEW_LAYOUT.saveBlock2PokedexOffset + NEW_LAYOUT.pokedexOwnedOffset;
    const newSeenOffset = NEW_LAYOUT.saveBlock2PokedexOffset + NEW_LAYOUT.pokedexSeenOffset;

    const oldOwnedLength = OLD_LAYOUT.pokedexSeenOffset - OLD_LAYOUT.pokedexOwnedOffset;
    const newOwnedLength = NEW_LAYOUT.pokedexSeenOffset - NEW_LAYOUT.pokedexOwnedOffset;

    const oldSeenLength = OLD_LAYOUT.pokedexSize - OLD_LAYOUT.pokedexSeenOffset;
    const newSeenLength = NEW_LAYOUT.pokedexSize - NEW_LAYOUT.pokedexSeenOffset;

    const newBlock = new Uint8Array(NEW_LAYOUT.saveBlock2Size);

    // Before owned[]
    newBlock.set(oldBlock.slice(0, oldOwnedOffset), 0);

    // owned[]
    copyExpandedArray({
      oldBlock,
      newBlock,
      oldOffset: oldOwnedOffset,
      oldLength: oldOwnedLength,
      newOffset: newOwnedOffset,
      newLength: newOwnedLength,
    });

    // Between owned[] and seen[]
    newBlock.set(
      oldBlock.slice(oldOwnedOffset + oldOwnedLength, oldSeenOffset),
      newOwnedOffset + newOwnedLength
    );

    // seen[]
    copyExpandedArray({
      oldBlock,
      newBlock,
      oldOffset: oldSeenOffset,
      oldLength: oldSeenLength,
      newOffset: newSeenOffset,
      newLength: newSeenLength,
    });

    // After seen[]
    newBlock.set(
      oldBlock.slice(oldSeenOffset + oldSeenLength, OLD_LAYOUT.saveBlock2Size),
      newSeenOffset + newSeenLength
    );

    return newBlock;
  }

  function migrateSaveBlock1(oldBlock: Uint8Array<ArrayBuffer>) {
      const newBlock = new Uint8Array(NEW_LAYOUT.saveBlock1Size);

      const oldSeen1Offset = OLD_LAYOUT.saveBlock1Seen1Offset;
      const oldSeen2Offset = OLD_LAYOUT.saveBlock1Seen2Offset;
      const oldDexNavSearchLevelsOffset = OLD_LAYOUT.dexNavSearchLevelsOffset;
      //const oldDexNavChainOffset = OLD_LAYOUT.dexNavChainOffset;

      const newSeen1Offset = NEW_LAYOUT.saveBlock1Seen1Offset;
      const newSeen2Offset = NEW_LAYOUT.saveBlock1Seen2Offset;
      const newDexNavSearchLevelsOffset = NEW_LAYOUT.dexNavSearchLevelsOffset;
      //const newDexNavChainOffset = NEW_LAYOUT.dexNavChainOffset;

      const oldSeenLength = OLD_DEX_FLAG_BYTES;
      const newSeenLength = NEW_DEX_FLAG_BYTES;

      const oldDexNavLength = OLD_LAYOUT.dexNavChainOffset - OLD_LAYOUT.dexNavSearchLevelsOffset;
      const newDexNavLength = NEW_LAYOUT.dexNavChainOffset - NEW_LAYOUT.dexNavSearchLevelsOffset;
      
      //copy range before seen1
      newBlock.set(oldBlock.slice(0, oldSeen1Offset), 0);
      //expand seen1
      copyExpandedArray({
          oldBlock,
          newBlock,
          oldOffset: oldSeen1Offset,
          oldLength: oldSeenLength,
          newOffset: newSeen1Offset,
          newLength: newSeenLength,
      });

      //copy range between seen1 and seen2
      newBlock.set(oldBlock.slice(oldSeen1Offset + oldSeenLength, oldSeen2Offset), newSeen1Offset + newSeenLength);
      //expand seen2
      copyExpandedArray({
          oldBlock,
          newBlock,
          oldOffset: oldSeen2Offset,
          oldLength: oldSeenLength,
          newOffset: newSeen2Offset,
          newLength: newSeenLength,
      });

      //copy range between seen2 and dexNavSearchLevels
      newBlock.set(oldBlock.slice(oldSeen2Offset + oldSeenLength, oldDexNavSearchLevelsOffset), newSeen2Offset + newSeenLength);

      //expand dexNavSearchLevels
      copyExpandedArray({
          oldBlock,
          newBlock,
          oldOffset: oldDexNavSearchLevelsOffset,
          oldLength: oldDexNavLength,
          newOffset: newDexNavSearchLevelsOffset,
          newLength: newDexNavLength,
      });

      //copy range after dexNavSearchLevels, including dexNavChain
      const oldTailOffset = oldDexNavSearchLevelsOffset + oldDexNavLength;
      const newTailOffset = newDexNavSearchLevelsOffset + newDexNavLength;
      const tailLength = Math.min(
          OLD_LAYOUT.saveBlock1Size - oldTailOffset,
          NEW_LAYOUT.saveBlock1Size - newTailOffset
      );
      newBlock.set(oldBlock.slice(oldTailOffset, oldTailOffset + tailLength), newTailOffset);
      

      return newBlock;
  }

  function writeBlockToSectors(slot: Slot, startId: number, endId: number, block: Uint8Array<ArrayBuffer>, sectorSizes: number[]) {
    for (let id = startId; id <= endId; id++) {
      const sector = slot.sectorsById.get(id);
      const chunkIndex = id - startId;
      const chunkOffset = chunkIndex * SECTOR_DATA_SIZE;
      const chunkSize = sectorSizes[id];

      if(!!sector) {
        // Clear whole data area first so old trailing bytes do not remain.
        sector.bytes.fill(0, 0, SECTOR_DATA_SIZE);

        // Copy this block chunk into sector data.
        sector.bytes.set(
          block.slice(chunkOffset, chunkOffset + chunkSize),
          0
        );

        // Recompute checksum using the new logical chunk size.
        const checksum = calcChecksum(sector.bytes.slice(0, SECTOR_DATA_SIZE), chunkSize);
        setU16(sector.bytes, CHECKSUM_OFFSET, checksum);

        // Keep object metadata in sync.
        sector.checksum = checksum;
      }
    }
  }

  function writeSlotBackToSave(saveBytes: Uint8Array<ArrayBuffer>, slot: Slot) {
    const slotStart = slot.slotIndex * SLOT_SIZE;

    for (const sector of slot.sectorsById.values()) {
      const start = slotStart + sector.physicalIndex * SECTOR_SIZE;
      saveBytes.set(sector.bytes, start);
    }
  }

}

export default App
