# Third-party statement fixtures

The files under `real/` are copies of sample bank-statement exports published in
the open-source repositories listed below, vendored so the statement importer is
tested against each bank's real header, preamble, quoting and date conventions.
Every file is unmodified and keeps its original name (prefixed by its folder in
the source where names would otherwise collide). All of them are synthetic:
placeholder names (JOHN DOE, RAHUL SHARMA, SAMPLE USER, ACME), example.com
addresses and made-up account numbers. Files from the same repositories that
carried anything resembling a real person's details were deliberately not
copied; their layouts are re-created by hand under `../specimen-shaped/`.

`scripts/statement-revalidate.mjs` reads the table below to re-fetch each file
from its repository's default branch and report drift, so keep the columns as
they are: vendored path, repository URL, path in the repository, the commit the
copy was taken from, licence.

## Sources

| Vendored file                                                              | Repository                                                | Path in repository                                    | Commit                                   | Licence    |
| -------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------- | ---------- |
| openaccountant-wilson/bofa-checking-standard.csv                           | https://github.com/openaccountant/wilson                  | data/csv/bofa-checking/standard.csv                   | 7d252a2296bb639a6b3e187e8ecccd4ff36d0bde | MIT        |
| openaccountant-wilson/bofa-checking-edge-cases.csv                         | https://github.com/openaccountant/wilson                  | data/csv/bofa-checking/edge-cases.csv                 | 7d252a2296bb639a6b3e187e8ecccd4ff36d0bde | MIT        |
| openaccountant-wilson/chase-standard.csv                                   | https://github.com/openaccountant/wilson                  | data/csv/chase/standard.csv                           | 7d252a2296bb639a6b3e187e8ecccd4ff36d0bde | MIT        |
| openaccountant-wilson/chase-edge-cases.csv                                 | https://github.com/openaccountant/wilson                  | data/csv/chase/edge-cases.csv                         | 7d252a2296bb639a6b3e187e8ecccd4ff36d0bde | MIT        |
| openaccountant-wilson/generic-debit-credit-cols.csv                        | https://github.com/openaccountant/wilson                  | data/csv/generic/debit-credit-cols.csv                | 7d252a2296bb639a6b3e187e8ecccd4ff36d0bde | MIT        |
| openaccountant-wilson/generic-edge-cases.csv                               | https://github.com/openaccountant/wilson                  | data/csv/generic/edge-cases.csv                       | 7d252a2296bb639a6b3e187e8ecccd4ff36d0bde | MIT        |
| mentria-ai-website/in-icici.csv                                            | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/in-icici.csv          | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/in-axis.csv                                             | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/in-axis.csv           | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/in-kotak.csv                                            | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/in-kotak.csv          | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/in-sbi.txt                                              | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/in-sbi.txt            | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/in-drcr.csv                                             | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/in-drcr.csv           | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/us-chase-checking.csv                                   | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/us-chase-checking.csv | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/us-chase-card.csv                                       | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/us-chase-card.csv     | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/us-bofa.csv                                             | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/us-bofa.csv           | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/us-wellsfargo.csv                                       | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/us-wellsfargo.csv     | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/uk-monzo.csv                                            | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/uk-monzo.csv          | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/eu-revolut.csv                                          | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/eu-revolut.csv        | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| mentria-ai-website/us-ofx2.ofx                                             | https://github.com/mentria-ai/website                     | scripts/fixtures/finance-import/us-ofx2.ofx           | 2c1ebfc33bdc79be272f37a2d999d439a6eb8c5d | MIT        |
| raptar231-indian-bank-statement-parser/hdfc/hdfc_savings-april-2026.txt    | https://github.com/raptar231/indian-bank-statement-parser | tests/fixtures/hdfc/hdfc_savings-april-2026.txt       | 53a2486b1726d7882d208c6856463dc312bcd075 | Apache-2.0 |
| raptar231-indian-bank-statement-parser/sbi/netbanking_2021_22.txt          | https://github.com/raptar231/indian-bank-statement-parser | tests/fixtures/sbi/netbanking_2021_22.txt             | 53a2486b1726d7882d208c6856463dc312bcd075 | Apache-2.0 |
| raptar231-indian-bank-statement-parser/sbi/netbanking_2018_19.txt          | https://github.com/raptar231/indian-bank-statement-parser | tests/fixtures/sbi/netbanking_2018_19.txt             | 53a2486b1726d7882d208c6856463dc312bcd075 | Apache-2.0 |
| raptar231-indian-bank-statement-parser/sbi/yono_savings_multi_jan_2026.txt | https://github.com/raptar231/indian-bank-statement-parser | tests/fixtures/sbi/yono_savings_multi_jan_2026.txt    | 53a2486b1726d7882d208c6856463dc312bcd075 | Apache-2.0 |
| KanveerMadan-Vaulta/axis.csv                                               | https://github.com/KanveerMadan/Vaulta                    | fixtures/statements/axis.csv                          | 0f949abf1bcbe63a116b40b4d24f18269e984718 | MIT        |
| KanveerMadan-Vaulta/icici.csv                                              | https://github.com/KanveerMadan/Vaulta                    | fixtures/statements/icici.csv                         | 0f949abf1bcbe63a116b40b4d24f18269e984718 | MIT        |
| KanveerMadan-Vaulta/kotak.csv                                              | https://github.com/KanveerMadan/Vaulta                    | fixtures/statements/kotak.csv                         | 0f949abf1bcbe63a116b40b4d24f18269e984718 | MIT        |
| KanveerMadan-Vaulta/sbi.csv                                                | https://github.com/KanveerMadan/Vaulta                    | fixtures/statements/sbi.csv                           | 0f949abf1bcbe63a116b40b4d24f18269e984718 | MIT        |
| KanveerMadan-Vaulta/hdfc.csv                                               | https://github.com/KanveerMadan/Vaulta                    | fixtures/statements/hdfc.csv                          | 0f949abf1bcbe63a116b40b4d24f18269e984718 | MIT        |
| CaptainAni187-residual/statement_axis.csv                                  | https://github.com/CaptainAni187/residual                 | public/samples/statement_axis.csv                     | 954d0d34351fcf5102b12950d68da69c6c60dd83 | MIT        |
| CaptainAni187-residual/statement_icici.csv                                 | https://github.com/CaptainAni187/residual                 | public/samples/statement_icici.csv                    | 954d0d34351fcf5102b12950d68da69c6c60dd83 | MIT        |
| CaptainAni187-residual/statement_sbi.csv                                   | https://github.com/CaptainAni187/residual                 | public/samples/statement_sbi.csv                      | 954d0d34351fcf5102b12950d68da69c6c60dd83 | MIT        |
| jseutter-ofxparse/anzcc.ofx                                                | https://github.com/jseutter/ofxparse                      | tests/fixtures/anzcc.ofx                              | 25aa80072be71da9f4ea0924ae1d1aaea2d5820c | MIT        |
| jseutter-ofxparse/suncorp.ofx                                              | https://github.com/jseutter/ofxparse                      | tests/fixtures/suncorp.ofx                            | 25aa80072be71da9f4ea0924ae1d1aaea2d5820c | MIT        |
| jseutter-ofxparse/checking.ofx                                             | https://github.com/jseutter/ofxparse                      | tests/fixtures/checking.ofx                           | 25aa80072be71da9f4ea0924ae1d1aaea2d5820c | MIT        |
| jseutter-ofxparse/bank_medium.ofx                                          | https://github.com/jseutter/ofxparse                      | tests/fixtures/bank_medium.ofx                        | 25aa80072be71da9f4ea0924ae1d1aaea2d5820c | MIT        |
| jseutter-ofxparse/bank_small.ofx                                           | https://github.com/jseutter/ofxparse                      | tests/fixtures/bank_small.ofx                         | 25aa80072be71da9f4ea0924ae1d1aaea2d5820c | MIT        |
| MugenLab-ledgerbridge/revolut.csv                                          | https://github.com/MugenLab/ledgerbridge                  | tests/fixtures/revolut.csv                            | 1f921d9f14f037e04ad0e694e7e78f1772dbe4fc | MIT        |
| MugenLab-ledgerbridge/ofx_comma_decimals.ofx                               | https://github.com/MugenLab/ledgerbridge                  | tests/fixtures/ofx_comma_decimals.ofx                 | 1f921d9f14f037e04ad0e694e7e78f1772dbe4fc | MIT        |
| MugenLab-ledgerbridge/ofx2_header_sgml_body.ofx                            | https://github.com/MugenLab/ledgerbridge                  | tests/fixtures/ofx2_header_sgml_body.ofx              | 1f921d9f14f037e04ad0e694e7e78f1772dbe4fc | MIT        |
| MugenLab-ledgerbridge/creditcard.qfx                                       | https://github.com/MugenLab/ledgerbridge                  | tests/fixtures/creditcard.qfx                         | 1f921d9f14f037e04ad0e694e7e78f1772dbe4fc | MIT        |
| MugenLab-ledgerbridge/bank_ofx1.ofx                                        | https://github.com/MugenLab/ledgerbridge                  | tests/fixtures/bank_ofx1.ofx                          | 1f921d9f14f037e04ad0e694e7e78f1772dbe4fc | MIT        |
| Maxed-OSS-statement-normalizer/chase_checking.csv                          | https://github.com/Maxed-OSS/statement-normalizer         | examples/chase_checking.csv                           | 0963c962a5ab618761ab57b604bad10578d39a0f | Apache-2.0 |
| Maxed-OSS-statement-normalizer/bofa_checking.csv                           | https://github.com/Maxed-OSS/statement-normalizer         | examples/bofa_checking.csv                            | 0963c962a5ab618761ab57b604bad10578d39a0f | Apache-2.0 |
| Maxed-OSS-statement-normalizer/wells_fargo_checking.csv                    | https://github.com/Maxed-OSS/statement-normalizer         | examples/wells_fargo_checking.csv                     | 0963c962a5ab618761ab57b604bad10578d39a0f | Apache-2.0 |
| Maxed-OSS-statement-normalizer/capital_one_creditcard.csv                  | https://github.com/Maxed-OSS/statement-normalizer         | examples/capital_one_creditcard.csv                   | 0963c962a5ab618761ab57b604bad10578d39a0f | Apache-2.0 |

Permalink for any row: `<Repository>/blob/<Commit>/<Path in repository>`.

Not vendored, and re-created by hand under `../specimen-shaped/` instead:
`raptar231/indian-bank-statement-parser` `tests/fixtures/icici/*`, `tests/fixtures/axis/*`,
`tests/fixtures/hdfc/hdfc_savings-new-apr-2024.txt`, `tests/fixtures/hdfc/hdfc_savings-old-mar-2019.txt`
and `tests/fixtures/kotak/kotak_savings-jul-2025.txt` (names, phone numbers, VPAs or account numbers
that could belong to real people); `asappia/uae2ynab`'s ADCB sample (no licence file); the
bank-published Bank of America, Wells Fargo, ANZ, Westpac and CommBank specimens (bank copyright).

## Notices

### MIT-licensed sources

- `openaccountant/wilson` — Copyright (c) 2025-present OpenSpend Contributors
- `mentria-ai/website` — Copyright (c) 2025 mentria.ai
- `KanveerMadan/Vaulta` — Copyright (c) 2026 Kanveer Madan (its `fixtures/statements/README.md`: "All names, numbers, VPAs and account details are made up.")
- `CaptainAni187/residual` — Copyright (c) 2026 CaptainAni187
- `jseutter/ofxparse` — Copyright (c) 2009 Jerry Seutter
- `MugenLab/ledgerbridge` — Copyright (c) 2026 ledgerbridge contributors

Each of the above is licensed under the MIT License:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache-2.0-licensed sources

- `raptar231/indian-bank-statement-parser` — Copyright 2024-2026 Koushik Mondal (github.com/raptar231). Its `.licenserc.yaml` excludes `tests/fixtures` from the per-file licence header, so the files carry none; they are covered by the repository's `LICENSE`. Neither repository ships a NOTICE file.
- `Maxed-OSS/statement-normalizer` — no copyright line in the repository beyond its `LICENSE`.

Both are licensed under the Apache License, Version 2.0 (the "License"); the
files are used in compliance with the License. A copy of the License follows;
it is also at http://www.apache.org/licenses/LICENSE-2.0. The files are
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
either express or implied. No file from either repository was modified.

```

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
