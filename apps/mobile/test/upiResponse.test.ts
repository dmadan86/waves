import { describe, expect, it } from 'vitest';
import { parseUpiResponse } from '../src/lib/upiResponse';

describe('parseUpiResponse', () => {
  it('preserves all raw callback fields without confirming SUCCESS', () => {
    expect(
      parseUpiResponse('txnId=001&responseCode=00&Status=SUCCESS&txnRef=ref&ApprovalRefNo=123'),
    ).toEqual({
      txnId: '001',
      responseCode: '00',
      Status: 'SUCCESS',
      txnRef: 'ref',
      ApprovalRefNo: '123',
    });
  });
  it('omits absent fields and ignores unknown fields', () => {
    expect(parseUpiResponse('Status=FAILURE&confirmed=true&__proto__=x')).toEqual({
      Status: 'FAILURE',
    });
  });
  it('accepts case variations and decodes values, including embedded equals and ampersands', () => {
    expect(
      parseUpiResponse('TXNID=a%26b%3Dc&status=Submitted&txnref=hello+world&approvalrefno=x=y'),
    ).toEqual({
      txnId: 'a&b=c',
      Status: 'Submitted',
      txnRef: 'hello world',
      ApprovalRefNo: 'x=y',
    });
  });
  it('preserves empty fields and uses the last duplicate', () => {
    expect(parseUpiResponse('txnId=old&txnId=new&txnRef=')).toEqual({ txnId: 'new', txnRef: '' });
  });
  it('tolerates malformed encoding and segments without equals', () => {
    expect(parseUpiResponse('broken&txnId=%ZZ&Status=FAILURE')).toEqual({
      txnId: '%ZZ',
      Status: 'FAILURE',
    });
  });
  it.each([null, undefined, '', 'unknown=value', 'cancelled'])(
    'returns null when no known fields exist: %s',
    (raw) => {
      expect(parseUpiResponse(raw)).toBeNull();
    },
  );
});
