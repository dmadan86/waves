import { describe, expect, it } from 'vitest';

import { decodeBytes, detectDelimiter, readTable } from '../../src/import/table.js';
import { fixtureBytes as fixture } from './fixtures.js';

const utf16 = (text: string, littleEndian: boolean): Uint8Array => {
  const bytes: number[] = littleEndian ? [0xff, 0xfe] : [0xfe, 0xff];
  for (const unit of text) {
    const code = unit.charCodeAt(0);
    bytes.push(...(littleEndian ? [code & 0xff, code >> 8] : [code >> 8, code & 0xff]));
  }
  return new Uint8Array(bytes);
};

describe('decodeBytes', () => {
  it('reads plain and BOM-prefixed UTF-8', () => {
    const body = new TextEncoder().encode('Café ₹ 日本');
    expect(decodeBytes(body)).toMatchObject({
      text: 'Café ₹ 日本',
      encoding: 'utf-8',
      lossy: false,
    });
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
    expect(decodeBytes(withBom).text).toBe('Café ₹ 日本');
  });

  it('reads UTF-16 in both byte orders', () => {
    expect(decodeBytes(utf16('a,b\nÉ,₹', true))).toMatchObject({
      text: 'a,b\nÉ,₹',
      encoding: 'utf-16le',
    });
    expect(decodeBytes(utf16('a,b\nÉ,₹', false))).toMatchObject({
      text: 'a,b\nÉ,₹',
      encoding: 'utf-16be',
    });
  });

  it('falls back to Windows-1252 when the bytes are not UTF-8', () => {
    const decoded = decodeBytes(fixture('excel-cp1252.csv'));
    expect(decoded.encoding).toBe('windows-1252');
    expect(decoded.lossy).toBe(false);
    expect(decoded.text).toContain('Café Müller');
    expect(decoded.text).toContain('Währung');
  });

  it('maps the Windows-1252 punctuation block and flags the unmapped bytes', () => {
    expect(decodeBytes(new Uint8Array([0x80, 0x93, 0x94, 0x96, 0xe9])).text).toBe('€“”–é');
    expect(decodeBytes(new Uint8Array([0x41, 0x81])).lossy).toBe(true);
  });

  it('rejects overlong and truncated UTF-8 rather than guessing', () => {
    expect(decodeBytes(new Uint8Array([0xc0, 0x80])).encoding).toBe('windows-1252');
    expect(decodeBytes(new Uint8Array([0xe2, 0x82])).encoding).toBe('windows-1252');
  });
});

describe('detectDelimiter', () => {
  it('picks the most consistent delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
  });

  it('ignores delimiters inside quotes and prefers the steady count', () => {
    expect(detectDelimiter('desc;amount\n"a, b, c, d";10\n"e, f";20')).toBe(';');
  });

  it('honours Excel’s sep= line over the counts', () => {
    expect(detectDelimiter('sep=|\na,b,c\n1,2,3')).toBe('|');
  });

  it('defaults to a comma for a single column', () => {
    expect(detectDelimiter('hello\nworld')).toBe(',');
  });
});

describe('readTable', () => {
  it('handles CRLF, CR and LF line ends and a BOM', () => {
    for (const eol of ['\r\n', '\r', '\n']) {
      const table = readTable(`﻿a,b${eol}1,2${eol}3,4${eol}`);
      expect(table.rows).toEqual([
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
      ]);
    }
  });

  it('keeps a quoted newline inside one cell and numbers lines from the file', () => {
    const table = readTable('d,x\n"line one\nline two",1\nnext,2');
    expect(table.rows[1]).toEqual(['line one\nline two', '1']);
    expect(table.lines).toEqual([1, 2, 4]);
  });

  it('unescapes doubled quotes and keeps a quote in the middle of a bare cell', () => {
    expect(readTable('a,b\n"say ""hi""",5" nails').rows[1]).toEqual(['say "hi"', '5" nails']);
  });

  it('drops blank rows and trims cells', () => {
    const table = readTable('a , b\n\n  ,  \n 1 , 2 \n');
    expect(table.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(table.lines).toEqual([1, 4]);
  });

  it('reads sep= files with the delimiter they declare', () => {
    expect(readTable('sep=;\na;b\n1,5;2').rows).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ]);
  });

  it('reads semicolon, tab and pipe files', () => {
    expect(readTable('a;b\n1;2').rows[1]).toEqual(['1', '2']);
    expect(readTable('a\tb\n1\t2').rows[1]).toEqual(['1', '2']);
    expect(readTable('a|b\n1|2').rows[1]).toEqual(['1', '2']);
  });

  it('keeps empty trailing cells and tolerates an unterminated quote', () => {
    expect(readTable('a,b,\n1,,').rows).toEqual([
      ['a', 'b', ''],
      ['1', '', ''],
    ]);
    expect(readTable('a,b\n"open,1').rows[1]).toEqual(['open,1']);
  });

  it('strips the quote our own export adds before a formula character', () => {
    expect(readTable("a\n'=SUM(1)\n'-5\n'plain").rows.flat()).toEqual([
      'a',
      '=SUM(1)',
      '-5',
      "'plain",
    ]);
  });

  it('reads the 2,000-row stress file', () => {
    const decoded = decodeBytes(fixture('stress-2000.csv'));
    const table = readTable(decoded.text);
    expect(table.rows).toHaveLength(2001);
    expect(table.delimiter).toBe(',');
  });
});
