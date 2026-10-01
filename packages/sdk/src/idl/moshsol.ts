/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/moshsol.json`.
 */
export type Moshsol = {
  "address": "EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ",
  "metadata": {
    "name": "moshsol",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Bundle launchpad: locked backer vaults traded by rate-limited agents"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "newAdmin",
          "signer": true
        },
        {
          "name": "platform",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "adminWithdrawVault",
      "discriminator": [
        104,
        13,
        82,
        172,
        52,
        229,
        136,
        35
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "platform"
          ]
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "vaultTokens",
          "docs": [
            "The vault's token account: the program PDA (Holdfast) or the pump authority's ATA."
          ],
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "recipientTokens",
          "writable": true
        },
        {
          "name": "tokenAuthority",
          "docs": [
            "PDA (pump launches); verified in the handler against the venue."
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "sol",
          "type": "u64"
        },
        {
          "name": "tokens",
          "type": "u64"
        }
      ]
    },
    {
      "name": "agentBuy",
      "discriminator": [
        26,
        219,
        253,
        44,
        79,
        91,
        19,
        198
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "curveTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": [
        {
          "name": "solIn",
          "type": "u64"
        },
        {
          "name": "minTokensOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "agentBuyPump",
      "discriminator": [
        90,
        159,
        177,
        183,
        140,
        5,
        20,
        182
      ],
      "accounts": [
        {
          "name": "agent",
          "docs": [
            "Fronts the transient WSOL account rent on PumpSwap (returned in the same instruction)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "pumpAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  109,
                  112,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultTokens",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "solIn",
          "type": "u64"
        },
        {
          "name": "minTokensOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "agentSell",
      "discriminator": [
        122,
        171,
        119,
        122,
        223,
        127,
        182,
        120
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "curveTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": [
        {
          "name": "tokensIn",
          "type": "u64"
        },
        {
          "name": "minSolOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "agentSellPump",
      "discriminator": [
        145,
        198,
        183,
        177,
        229,
        236,
        144,
        101
      ],
      "accounts": [
        {
          "name": "agent",
          "docs": [
            "Fronts the transient WSOL account rent on PumpSwap (returned in the same instruction)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "pumpAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  109,
                  112,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultTokens",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tokensIn",
          "type": "u64"
        },
        {
          "name": "minSolOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "buy",
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "curveTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "traderTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "solIn",
          "type": "u64"
        },
        {
          "name": "minTokensOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "buybackBurn",
      "discriminator": [
        20,
        254,
        58,
        252,
        209,
        32,
        111,
        97
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "The platform's agent authority: it sizes and times the buyback and prices the floor",
            "off-chain. Pays the launch's token account for the buyback mint once; fronts WSOL rent",
            "on PumpSwap."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "pumpAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  109,
                  112,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "buybackMint",
          "docs": [
            "refuses the unset default"
          ],
          "writable": true
        },
        {
          "name": "burnTokens",
          "writable": true
        },
        {
          "name": "buybackCurve"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxSol",
          "type": "u64"
        },
        {
          "name": "minTokensOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancelLaunch",
      "discriminator": [
        120,
        69,
        17,
        7,
        41,
        48,
        40,
        37
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "launch"
          ]
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claimBackerFees",
      "discriminator": [
        234,
        26,
        209,
        192,
        20,
        160,
        240,
        25
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "backer"
          ]
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          },
          "relations": [
            "backer"
          ]
        },
        {
          "name": "backer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claimCreatorFees",
      "discriminator": [
        0,
        23,
        125,
        234,
        156,
        118,
        134,
        89
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "launch"
          ]
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "collectPumpFees",
      "discriminator": [
        117,
        129,
        9,
        79,
        108,
        55,
        145,
        38
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Fronts the transient WSOL account rent on PumpSwap (returned in the same instruction)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "creatorVault",
          "writable": true
        },
        {
          "name": "pumpEventAuthority"
        },
        {
          "name": "pumpProgram",
          "address": "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createLaunch",
      "discriminator": [
        239,
        223,
        255,
        134,
        39,
        121,
        127,
        62
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "platform",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "signer": true
        },
        {
          "name": "curveTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createLaunchArgs"
            }
          }
        }
      ]
    },
    {
      "name": "createLaunchPump",
      "discriminator": [
        206,
        27,
        189,
        23,
        180,
        23,
        134,
        125
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "platform",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "createKey",
          "docs": [
            "One-time signer that seeds the launch PDA (the mint doesn't exist until `launch_pump`)."
          ],
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "createKey"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createLaunchPumpArgs"
            }
          }
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "backer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "graduatePump",
      "discriminator": [
        54,
        147,
        28,
        222,
        119,
        18,
        29,
        130
      ],
      "accounts": [
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "bondingCurve"
        },
        {
          "name": "pool"
        }
      ],
      "args": []
    },
    {
      "name": "initializePlatform",
      "discriminator": [
        119,
        201,
        101,
        45,
        75,
        122,
        89,
        3
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "platform",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "programData",
          "docs": [
            "The program's ProgramData account; only its upgrade authority may initialize, which",
            "prevents anyone from front-running initialization after deploy."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  202,
                  155,
                  232,
                  83,
                  83,
                  33,
                  142,
                  237,
                  151,
                  16,
                  152,
                  47,
                  213,
                  232,
                  161,
                  13,
                  12,
                  43,
                  80,
                  82,
                  223,
                  134,
                  198,
                  45,
                  25,
                  59,
                  116,
                  25,
                  238,
                  1,
                  183,
                  171
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                2,
                168,
                246,
                145,
                78,
                136,
                161,
                176,
                226,
                16,
                21,
                62,
                247,
                99,
                174,
                43,
                0,
                194,
                185,
                61,
                22,
                193,
                36,
                210,
                192,
                83,
                122,
                16,
                4,
                128,
                0,
                0
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeRecipient",
          "type": "pubkey"
        },
        {
          "name": "agentAuthority",
          "type": "pubkey"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "platformParams"
            }
          }
        }
      ]
    },
    {
      "name": "launch",
      "discriminator": [
        153,
        241,
        93,
        225,
        22,
        69,
        74,
        61
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "curveTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": []
    },
    {
      "name": "launchPump",
      "discriminator": [
        163,
        44,
        244,
        189,
        85,
        31,
        115,
        175
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Pays the vault token account's rent (never refunded; it outlives the launch)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "pumpAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  109,
                  112,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Ephemeral keypair; pump.fun creates the mint at this address."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "mintAuthority"
        },
        {
          "name": "bondingCurve",
          "writable": true
        },
        {
          "name": "associatedBondingCurve",
          "writable": true
        },
        {
          "name": "global"
        },
        {
          "name": "mplTokenMetadata",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "metadata",
          "writable": true
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "pumpProgram",
          "address": "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        },
        {
          "name": "vaultTokens",
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "creatorVault",
          "writable": true
        },
        {
          "name": "globalVolumeAccumulator"
        },
        {
          "name": "userVolumeAccumulator",
          "writable": true
        },
        {
          "name": "feeConfig"
        },
        {
          "name": "feeProgram",
          "address": "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
        },
        {
          "name": "bondingCurveV2"
        },
        {
          "name": "buybackFeeRecipient",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "migrateLaunch",
      "docs": [
        "One-time per pre-payback launch after the upgrade: grows it to the current layout and",
        "backfills `initial_vault_sol` (see `LaunchV2::upgrade`)."
      ],
      "discriminator": [
        19,
        199,
        119,
        103,
        13,
        30,
        12,
        205
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "platform"
          ]
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "docs": [
            "length; its PDA seeds are checked against the decoded create key."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "initialVaultSol",
          "type": "u64"
        }
      ]
    },
    {
      "name": "migratePlatform",
      "docs": [
        "One-time after the payback upgrade: grows the platform account to the current layout."
      ],
      "discriminator": [
        199,
        188,
        136,
        113,
        2,
        148,
        42,
        14
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "platform",
          "docs": [
            "account no longer fits it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "payoutBackers",
      "discriminator": [
        3,
        116,
        183,
        144,
        113,
        218,
        91,
        59
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true
        },
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "proposeAdmin",
      "discriminator": [
        121,
        214,
        199,
        212,
        87,
        39,
        117,
        234
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "platform"
          ]
        },
        {
          "name": "platform",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "refund",
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "backer"
          ]
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          },
          "relations": [
            "backer"
          ]
        },
        {
          "name": "backer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "sell",
      "discriminator": [
        51,
        230,
        133,
        164,
        1,
        127,
        131,
        173
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "curveTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "traderTokens",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": [
        {
          "name": "tokensIn",
          "type": "u64"
        },
        {
          "name": "minSolOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setAgentAuthority",
      "discriminator": [
        250,
        203,
        192,
        81,
        102,
        63,
        241,
        120
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "platform"
          ]
        },
        {
          "name": "platform",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "agentAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setFeeRecipient",
      "discriminator": [
        227,
        18,
        215,
        42,
        237,
        246,
        151,
        66
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "platform"
          ]
        },
        {
          "name": "platform",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "feeRecipient",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "sweepPlatformFees",
      "discriminator": [
        190,
        168,
        25,
        182,
        75,
        123,
        135,
        189
      ],
      "accounts": [
        {
          "name": "platform",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "feeRecipient",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "updatePlatform",
      "discriminator": [
        46,
        78,
        138,
        189,
        47,
        163,
        120,
        85
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "platform"
          ]
        },
        {
          "name": "platform",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "platformParams"
            }
          }
        }
      ]
    },
    {
      "name": "windDown",
      "discriminator": [
        108,
        63,
        202,
        124,
        241,
        98,
        53,
        50
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "curveTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultTokens",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": []
    },
    {
      "name": "windDownPump",
      "discriminator": [
        207,
        217,
        240,
        125,
        166,
        186,
        165,
        97
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Fronts the transient WSOL account rent on PumpSwap (returned in the same instruction)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.create_key",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "pumpAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  109,
                  112,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultTokens",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "backer",
      "discriminator": [
        199,
        128,
        179,
        190,
        2,
        66,
        118,
        252
      ]
    },
    {
      "name": "launch",
      "discriminator": [
        144,
        51,
        51,
        163,
        206,
        85,
        213,
        38
      ]
    },
    {
      "name": "platform",
      "discriminator": [
        77,
        92,
        204,
        58,
        187,
        98,
        91,
        12
      ]
    }
  ],
  "events": [
    {
      "name": "backerFeesClaimed",
      "discriminator": [
        15,
        132,
        40,
        103,
        53,
        64,
        22,
        253
      ]
    },
    {
      "name": "backersPaid",
      "discriminator": [
        99,
        164,
        90,
        214,
        18,
        75,
        89,
        0
      ]
    },
    {
      "name": "buybackBurned",
      "discriminator": [
        186,
        84,
        241,
        202,
        152,
        185,
        0,
        115
      ]
    },
    {
      "name": "creatorFeesClaimed",
      "discriminator": [
        189,
        178,
        21,
        181,
        171,
        179,
        131,
        1
      ]
    },
    {
      "name": "creatorFeesCollected",
      "discriminator": [
        117,
        190,
        177,
        156,
        222,
        94,
        28,
        227
      ]
    },
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "launchCancelled",
      "discriminator": [
        210,
        90,
        18,
        45,
        176,
        239,
        185,
        155
      ]
    },
    {
      "name": "launchCreated",
      "discriminator": [
        59,
        38,
        190,
        230,
        33,
        34,
        89,
        20
      ]
    },
    {
      "name": "launchMigrated",
      "discriminator": [
        135,
        27,
        61,
        35,
        85,
        170,
        159,
        33
      ]
    },
    {
      "name": "launched",
      "discriminator": [
        209,
        127,
        29,
        152,
        129,
        212,
        189,
        183
      ]
    },
    {
      "name": "platformFeesSwept",
      "discriminator": [
        11,
        134,
        55,
        195,
        74,
        64,
        122,
        35
      ]
    },
    {
      "name": "pumpGraduated",
      "discriminator": [
        222,
        175,
        173,
        175,
        194,
        145,
        189,
        81
      ]
    },
    {
      "name": "refunded",
      "discriminator": [
        35,
        103,
        149,
        246,
        196,
        123,
        221,
        99
      ]
    },
    {
      "name": "trade",
      "discriminator": [
        24,
        254,
        218,
        152,
        253,
        43,
        18,
        81
      ]
    },
    {
      "name": "vaultWithdrawn",
      "discriminator": [
        238,
        9,
        219,
        172,
        188,
        77,
        72,
        104
      ]
    },
    {
      "name": "woundDown",
      "discriminator": [
        142,
        12,
        111,
        236,
        170,
        205,
        60,
        118
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer is not authorized for this action"
    },
    {
      "code": 6001,
      "name": "invalidParam",
      "msg": "Parameter out of allowed bounds"
    },
    {
      "code": 6002,
      "name": "invalidMetadata",
      "msg": "Name, symbol or URI too long or empty"
    },
    {
      "code": 6003,
      "name": "paused",
      "msg": "Platform is paused"
    },
    {
      "code": 6004,
      "name": "agentsPaused",
      "msg": "Agents are paused"
    },
    {
      "code": 6005,
      "name": "notRaising",
      "msg": "Launch is not raising"
    },
    {
      "code": 6006,
      "name": "notLive",
      "msg": "Launch is not live"
    },
    {
      "code": 6007,
      "name": "notRefunding",
      "msg": "Launch is not refunding"
    },
    {
      "code": 6008,
      "name": "raiseClosed",
      "msg": "Raise deadline has passed"
    },
    {
      "code": 6009,
      "name": "raiseStillOpen",
      "msg": "Raise is still open"
    },
    {
      "code": 6010,
      "name": "raiseFull",
      "msg": "Raise is full"
    },
    {
      "code": 6011,
      "name": "walletCapReached",
      "msg": "Wallet deposit cap reached"
    },
    {
      "code": 6012,
      "name": "minimumNotReached",
      "msg": "Raise minimum not reached"
    },
    {
      "code": 6013,
      "name": "minimumReached",
      "msg": "Raise minimum was reached; refunds unavailable"
    },
    {
      "code": 6014,
      "name": "notWhitelisted",
      "msg": "Wallet is not on the whitelist"
    },
    {
      "code": 6015,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6016,
      "name": "slippage",
      "msg": "Output below minimum (slippage)"
    },
    {
      "code": 6017,
      "name": "insufficientLiquidity",
      "msg": "Insufficient curve liquidity"
    },
    {
      "code": 6018,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6019,
      "name": "agentWindowLimit",
      "msg": "Agent window limit exceeded"
    },
    {
      "code": 6020,
      "name": "agentPriceImpact",
      "msg": "Agent trade exceeds max price impact"
    },
    {
      "code": 6021,
      "name": "agentBuyNotDip",
      "msg": "Agents may only buy below the EMA band"
    },
    {
      "code": 6022,
      "name": "agentSellNotRally",
      "msg": "Agents may only sell above the EMA band"
    },
    {
      "code": 6023,
      "name": "insufficientVault",
      "msg": "Insufficient vault balance"
    },
    {
      "code": 6024,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6025,
      "name": "alreadyRefunded",
      "msg": "Already refunded"
    },
    {
      "code": 6026,
      "name": "noPendingAdmin",
      "msg": "No pending admin or signer mismatch"
    },
    {
      "code": 6027,
      "name": "agentAboveCostBasis",
      "msg": "Agents may only buy below the vault's average cost, or buy back with sell proceeds below the average sell price"
    },
    {
      "code": 6028,
      "name": "agentBelowCostBasis",
      "msg": "Agents may only sell above the vault's average cost plus band"
    },
    {
      "code": 6029,
      "name": "notUpgradeAuthority",
      "msg": "Only the program upgrade authority can initialize the platform"
    },
    {
      "code": 6030,
      "name": "sameSlotTrade",
      "msg": "An agent trade and a public trade can't share a slot; retry in the next slot"
    },
    {
      "code": 6031,
      "name": "termsChanged",
      "msg": "Platform terms changed since this launch was prepared; review them and retry"
    },
    {
      "code": 6032,
      "name": "launchTooYoung",
      "msg": "Launch must be live for 3 days before it can wind down"
    },
    {
      "code": 6033,
      "name": "recentTrade",
      "msg": "Launch traded in the last 24 hours; it can't wind down yet"
    },
    {
      "code": 6034,
      "name": "outsideHolders",
      "msg": "More tokens are held outside the venue and vault than a dead launch allows; it can't wind down"
    },
    {
      "code": 6035,
      "name": "wrongVenue",
      "msg": "This instruction is for the other venue (Holdfast curve vs pump.fun)"
    },
    {
      "code": 6036,
      "name": "holdfastCurveDisabled",
      "msg": "Launches on the Holdfast curve are closed; create a pump.fun launch"
    },
    {
      "code": 6037,
      "name": "invalidVenueAccount",
      "msg": "A venue account is missing, has the wrong owner or the wrong layout"
    },
    {
      "code": 6038,
      "name": "curveComplete",
      "msg": "The pump.fun curve is complete; migrate it and run graduate_pump"
    },
    {
      "code": 6039,
      "name": "notGraduated",
      "msg": "The launch has not graduated to PumpSwap (or already has)"
    },
    {
      "code": 6040,
      "name": "buybackMintUnset",
      "msg": "The platform has no buyback mint yet"
    },
    {
      "code": 6041,
      "name": "buybackThrottled",
      "msg": "Buyback below the minimum size or too soon after the last one"
    },
    {
      "code": 6042,
      "name": "alreadyMigrated",
      "msg": "Account already uses the current layout"
    },
    {
      "code": 6043,
      "name": "payoutNotDue",
      "msg": "No backer payout is due: vault SOL under the payback target or the last payout is too recent"
    },
    {
      "code": 6044,
      "name": "vaultFloor",
      "msg": "Vault SOL may not drop below the launch's minimum vault reserve"
    }
  ],
  "types": [
    {
      "name": "backer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "deposited",
            "docs": [
              "Lamports deposited. Doubles as the fee-share weight."
            ],
            "type": "u64"
          },
          {
            "name": "feesClaimed",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "backerFeesClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "backer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "backersPaid",
      "docs": [
        "`payout_backers`: vault SOL credited to backers' claimable balance — `kind` 0 repays the",
        "principal (`initial_vault_sol`), 1 is a dividend (`payout_share_bps` of vault SOL)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "vaultSolAfter",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "buybackBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "buybackMint",
            "type": "pubkey"
          },
          {
            "name": "sol",
            "type": "u64"
          },
          {
            "name": "tokens",
            "type": "u64"
          },
          {
            "name": "buybackPoolSol",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "createLaunchArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "raiseMin",
            "type": "u64"
          },
          {
            "name": "raiseMax",
            "type": "u64"
          },
          {
            "name": "maxPerWallet",
            "docs": [
              "0 = no per-wallet cap"
            ],
            "type": "u64"
          },
          {
            "name": "durationSecs",
            "type": "i64"
          },
          {
            "name": "whitelistRoot",
            "docs": [
              "All zero = open raise"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bundleSupplyBps",
            "docs": [
              "Max share of supply the bundle buys at launch"
            ],
            "type": "u16"
          },
          {
            "name": "reserveBps",
            "docs": [
              "Share of the raise kept as SOL in the vault for agents to buy dips"
            ],
            "type": "u16"
          },
          {
            "name": "expectedTerms",
            "docs": [
              "Terms the creator reviewed; must equal what the platform would freeze into the launch now."
            ],
            "type": {
              "defined": {
                "name": "launchTerms"
              }
            }
          },
          {
            "name": "expectedVirtualSol",
            "type": "u64"
          },
          {
            "name": "maxCreateFeeLamports",
            "docs": [
              "Most the creator agreed to pay as the flat create fee."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "createLaunchPumpArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "raiseMin",
            "type": "u64"
          },
          {
            "name": "raiseMax",
            "type": "u64"
          },
          {
            "name": "maxPerWallet",
            "docs": [
              "0 = no per-wallet cap"
            ],
            "type": "u64"
          },
          {
            "name": "durationSecs",
            "type": "i64"
          },
          {
            "name": "whitelistRoot",
            "docs": [
              "All zero = open raise"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bundleSupplyBps",
            "docs": [
              "Max share of supply the bundle buys at launch"
            ],
            "type": "u16"
          },
          {
            "name": "reserveBps",
            "docs": [
              "Share of the raise kept as SOL in the vault for agents to buy dips"
            ],
            "type": "u16"
          },
          {
            "name": "expectedTerms",
            "docs": [
              "Terms the creator reviewed; must equal `LaunchTerms::pump` of the platform now."
            ],
            "type": {
              "defined": {
                "name": "launchTerms"
              }
            }
          },
          {
            "name": "maxCreateFeeLamports",
            "docs": [
              "Most the creator agreed to pay as the flat create fee."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeesClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "creatorFeesCollected",
      "docs": [
        "pump.fun / PumpSwap creator fees swept into the launch and split between the buyback pool,",
        "vault SOL (or backers once the launch is wound down) and backers."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "toBuybackPool",
            "type": "u64"
          },
          {
            "name": "toVault",
            "type": "u64"
          },
          {
            "name": "toBackers",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "backer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "raised",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "launch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "launchStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "curveBump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "launchedAt",
            "type": "i64"
          },
          {
            "name": "terms",
            "type": {
              "defined": {
                "name": "launchTerms"
              }
            }
          },
          {
            "name": "raiseMin",
            "type": "u64"
          },
          {
            "name": "raiseMax",
            "type": "u64"
          },
          {
            "name": "maxPerWallet",
            "type": "u64"
          },
          {
            "name": "raiseDeadline",
            "type": "i64"
          },
          {
            "name": "raised",
            "type": "u64"
          },
          {
            "name": "refunded",
            "type": "u64"
          },
          {
            "name": "backerCount",
            "type": "u32"
          },
          {
            "name": "whitelistRoot",
            "docs": [
              "sha256 merkle root of allowed backer pubkeys. All zero = open to everyone."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bundleSupplyBps",
            "type": "u16"
          },
          {
            "name": "reserveBps",
            "type": "u16"
          },
          {
            "name": "virtualSol",
            "type": "u64"
          },
          {
            "name": "realSol",
            "type": "u64"
          },
          {
            "name": "tokenReserve",
            "type": "u64"
          },
          {
            "name": "vaultSol",
            "type": "u64"
          },
          {
            "name": "vaultTokens",
            "type": "u64"
          },
          {
            "name": "bundleSol",
            "type": "u64"
          },
          {
            "name": "bundleTokens",
            "type": "u64"
          },
          {
            "name": "vaultCostSol",
            "docs": [
              "SOL cost basis of the tokens currently in the vault (average-cost method)."
            ],
            "type": "u64"
          },
          {
            "name": "accFeePerShare",
            "type": "u128"
          },
          {
            "name": "backerFeesAccrued",
            "type": "u64"
          },
          {
            "name": "backerFeesClaimed",
            "type": "u64"
          },
          {
            "name": "creatorFeesUnclaimed",
            "type": "u64"
          },
          {
            "name": "creatorFeesClaimed",
            "type": "u64"
          },
          {
            "name": "platformFeesUnclaimed",
            "type": "u64"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "windowBuyCap",
            "type": "u64"
          },
          {
            "name": "windowSolSpent",
            "type": "u64"
          },
          {
            "name": "windowSellCap",
            "type": "u64"
          },
          {
            "name": "windowTokensSold",
            "type": "u64"
          },
          {
            "name": "emaPrice",
            "docs": [
              "Time-weighted EMA of the spot price, Q64.64 lamports per base unit. Updated with weight",
              "dt / (dt + period) so it can never be snapped to a new level in one step."
            ],
            "type": "u128"
          },
          {
            "name": "lastTradeTs",
            "type": "i64"
          },
          {
            "name": "agentBuys",
            "type": "u32"
          },
          {
            "name": "agentSells",
            "type": "u32"
          },
          {
            "name": "agentSolSpent",
            "type": "u64"
          },
          {
            "name": "agentSolReceived",
            "type": "u64"
          },
          {
            "name": "agentTokensSold",
            "docs": [
              "Cumulative tokens sold by agents (with agent_sol_received gives the average sell price)."
            ],
            "type": "u64"
          },
          {
            "name": "volumeSol",
            "type": "u64"
          },
          {
            "name": "tradeCount",
            "type": "u64"
          },
          {
            "name": "lastPublicTradeSlot",
            "docs": [
              "Slot of the last public buy/sell and of the last agent trade. Agents can't trade in a slot",
              "that already saw a public trade, and public trades can't follow an agent trade in the same",
              "slot, so nobody can wrap a vault trade atomically (one transaction or one bundle).",
              "Pump launches don't see public trades, so only `last_agent_trade_slot` moves there."
            ],
            "type": "u64"
          },
          {
            "name": "lastAgentTradeSlot",
            "type": "u64"
          },
          {
            "name": "venue",
            "type": {
              "defined": {
                "name": "venue"
              }
            }
          },
          {
            "name": "createKey",
            "docs": [
              "Second seed of the launch PDA: the mint for Holdfast launches, a one-time signer for",
              "pump launches (whose mint doesn't exist until `launch_pump`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "pump",
            "type": {
              "defined": {
                "name": "pumpState"
              }
            }
          },
          {
            "name": "buybackPoolSol",
            "docs": [
              "SOL waiting to be spent by `buyback_burn` on the Holdfast token."
            ],
            "type": "u64"
          },
          {
            "name": "creatorFeesCollected",
            "docs": [
              "Cumulative pump.fun / PumpSwap creator fees swept into the launch."
            ],
            "type": "u64"
          },
          {
            "name": "burnedSol",
            "type": "u64"
          },
          {
            "name": "burnedTokens",
            "type": "u64"
          },
          {
            "name": "lastBuybackTs",
            "type": "i64"
          },
          {
            "name": "name",
            "docs": [
              "Token metadata for pump launches, handed to pump.fun `create` at `launch_pump`."
            ],
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "initialVaultSol",
            "docs": [
              "SOL the vault started with at launch: bundle + reserve. The payback target is a",
              "multiple of it."
            ],
            "type": "u64"
          },
          {
            "name": "backersRepaid",
            "docs": [
              "Principal repaid to backers so far (`payout_backers`, kind 0)."
            ],
            "type": "u64"
          },
          {
            "name": "backerPayouts",
            "docs": [
              "Dividends paid to backers so far (`payout_backers`, kind 1)."
            ],
            "type": "u64"
          },
          {
            "name": "lastPayoutTs",
            "docs": [
              "Last payout (or launch) time; the next payout waits `payout_interval_secs` after it."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "launchCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "launchCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "raiseMin",
            "type": "u64"
          },
          {
            "name": "raiseMax",
            "type": "u64"
          },
          {
            "name": "raiseDeadline",
            "type": "i64"
          },
          {
            "name": "bundleSupplyBps",
            "type": "u16"
          },
          {
            "name": "reserveBps",
            "type": "u16"
          },
          {
            "name": "whitelisted",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "launchMigrated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "launchStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "raising"
          },
          {
            "name": "live"
          },
          {
            "name": "refunding"
          },
          {
            "name": "woundDown"
          }
        ]
      }
    },
    {
      "name": "launchTerms",
      "docs": [
        "Economic terms copied from the platform at `create_launch`. They can never change for the",
        "life of the launch, so backers know exactly what they signed up for."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "backerFeeShareBps",
            "type": "u16"
          },
          {
            "name": "creatorFeeShareBps",
            "type": "u16"
          },
          {
            "name": "launchFeeBps",
            "type": "u16"
          },
          {
            "name": "agentBuyBpsPerWindow",
            "type": "u16"
          },
          {
            "name": "agentSellBpsPerWindow",
            "type": "u16"
          },
          {
            "name": "agentMaxImpactBps",
            "type": "u16"
          },
          {
            "name": "agentBandBps",
            "type": "u16"
          },
          {
            "name": "agentWindowSecs",
            "type": "u32"
          },
          {
            "name": "emaPeriodSecs",
            "type": "u32"
          },
          {
            "name": "burnShareBps",
            "docs": [
              "Share of creator fees routed to the buyback-and-burn pool (pump launches)."
            ],
            "type": "u16"
          },
          {
            "name": "creatorFeeVaultBps",
            "docs": [
              "Share of creator fees that becomes vault SOL; the remainder goes to backers."
            ],
            "type": "u16"
          },
          {
            "name": "payoutMultBps",
            "docs": [
              "Backer payback terms (see `PlatformParams`)."
            ],
            "type": "u32"
          },
          {
            "name": "payoutShareBps",
            "type": "u16"
          },
          {
            "name": "payoutIntervalSecs",
            "type": "u32"
          },
          {
            "name": "deadHoldersBps",
            "type": "u16"
          },
          {
            "name": "minVaultSol",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "launched",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "raised",
            "type": "u64"
          },
          {
            "name": "launchFee",
            "type": "u64"
          },
          {
            "name": "bundleSol",
            "type": "u64"
          },
          {
            "name": "bundleTokens",
            "type": "u64"
          },
          {
            "name": "vaultSol",
            "type": "u64"
          },
          {
            "name": "priceQ64",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "platform",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "agentAuthority",
            "docs": [
              "The only key allowed to call agent_buy / agent_sell. It can never withdraw anything."
            ],
            "type": "pubkey"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "platformParams"
              }
            }
          },
          {
            "name": "launchCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "platformFeesSwept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "platformParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tradeFeeBps",
            "docs": [
              "Fee on every public trade, taken in SOL."
            ],
            "type": "u16"
          },
          {
            "name": "backerFeeShareBps",
            "docs": [
              "Portion of the trade fee paid to backers (pro-rata to their deposit)."
            ],
            "type": "u16"
          },
          {
            "name": "creatorFeeShareBps",
            "docs": [
              "Portion of the trade fee paid to the creator. Platform receives the remainder."
            ],
            "type": "u16"
          },
          {
            "name": "launchFeeBps",
            "docs": [
              "Cut of the raised SOL taken at launch."
            ],
            "type": "u16"
          },
          {
            "name": "createFeeLamports",
            "docs": [
              "Flat fee charged when creating a launch (anti-spam)."
            ],
            "type": "u64"
          },
          {
            "name": "virtualSolReserves",
            "docs": [
              "Virtual SOL reserves seeded into every new curve (sets the starting market cap)."
            ],
            "type": "u64"
          },
          {
            "name": "maxBundleSupplyBps",
            "type": "u16"
          },
          {
            "name": "minRaiseLamports",
            "type": "u64"
          },
          {
            "name": "agentBuyBpsPerWindow",
            "docs": [
              "Max share of vault SOL agents may spend per window."
            ],
            "type": "u16"
          },
          {
            "name": "agentSellBpsPerWindow",
            "docs": [
              "Max share of vault tokens agents may sell per window."
            ],
            "type": "u16"
          },
          {
            "name": "agentMaxImpactBps",
            "docs": [
              "Max price move from a single agent trade."
            ],
            "type": "u16"
          },
          {
            "name": "agentBandBps",
            "docs": [
              "Agents buy only when price <= EMA * (1 - band) and sell only when price >= EMA * (1 + band)."
            ],
            "type": "u16"
          },
          {
            "name": "agentWindowSecs",
            "type": "u32"
          },
          {
            "name": "emaPeriodSecs",
            "type": "u32"
          },
          {
            "name": "paused",
            "docs": [
              "Blocks new launches and deposits. Never blocks refunds, trading or claims."
            ],
            "type": "bool"
          },
          {
            "name": "agentsPaused",
            "docs": [
              "Blocks everything the agent authority cranks: agent trades, `payout_backers`, `buyback_burn`",
              "(circuit breaker)."
            ],
            "type": "bool"
          },
          {
            "name": "maxRaiseLamports",
            "docs": [
              "Beta cap on a new launch's `raise_max`; 0 = only the hard `MAX_RAISE_LAMPORTS` limit."
            ],
            "type": "u64"
          },
          {
            "name": "maxWalletDepositLamports",
            "docs": [
              "Beta cap on one wallet's total deposit into any raise, on top of the creator's own",
              "`max_per_wallet`; 0 = no platform cap."
            ],
            "type": "u64"
          },
          {
            "name": "holdfastCurveEnabled",
            "docs": [
              "Whether `create_launch` (a launch on Holdfast's own curve) is still open. Off on",
              "mainnet: new launches are pump.fun tokens (`create_launch_pump`)."
            ],
            "type": "bool"
          },
          {
            "name": "burnShareBps",
            "docs": [
              "Share of a pump launch's creator fees that goes to the Holdfast buyback-and-burn pool."
            ],
            "type": "u16"
          },
          {
            "name": "buybackMint",
            "docs": [
              "The Holdfast token `buyback_burn` buys and burns. `Pubkey::default()` = not set yet: the",
              "crank refuses and the pools keep accruing."
            ],
            "type": "pubkey"
          },
          {
            "name": "creatorFeeVaultBps",
            "docs": [
              "Share of a pump launch's creator fees that becomes vault SOL (the agent's capital). The",
              "rest after this and the burn share goes to backers."
            ],
            "type": "u16"
          },
          {
            "name": "payoutMultBps",
            "docs": [
              "Backer payback: the vault must hold this multiple (bps) of its initial SOL in liquid SOL",
              "before any payout."
            ],
            "type": "u32"
          },
          {
            "name": "payoutShareBps",
            "docs": [
              "Share of liquid vault SOL paid as a dividend once the principal is repaid."
            ],
            "type": "u16"
          },
          {
            "name": "payoutIntervalSecs",
            "docs": [
              "Minimum time between two backer payouts."
            ],
            "type": "u32"
          },
          {
            "name": "deadHoldersBps",
            "docs": [
              "`wind_down`: a launch is dead when outside holders own at most this share of supply."
            ],
            "type": "u16"
          },
          {
            "name": "minVaultSol",
            "docs": [
              "Liquid SOL the vault always keeps (fees, rent): agent buys and payouts never go below it."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pumpGraduated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pumpState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bondingCurve",
            "docs": [
              "pump.fun bonding curve of `mint` (set at `launch_pump`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "pool",
            "docs": [
              "PumpSwap pool, recorded by `graduate_pump` once the curve completed and migrated."
            ],
            "type": "pubkey"
          },
          {
            "name": "graduated",
            "type": "bool"
          },
          {
            "name": "authorityBump",
            "docs": [
              "Bump of the system-owned `[PUMP_AUTHORITY_SEED, launch]` PDA that is the venue `user`",
              "and the authority of the vault token account."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "refunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "backer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "trade",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "isBuy",
            "type": "bool"
          },
          {
            "name": "isAgent",
            "type": "bool"
          },
          {
            "name": "solAmount",
            "docs": [
              "Lamports paid (buy, gross incl. fee) or received (sell, net of fee)."
            ],
            "type": "u64"
          },
          {
            "name": "tokenAmount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "priceQ64",
            "type": "u128"
          },
          {
            "name": "emaQ64",
            "type": "u128"
          },
          {
            "name": "realSol",
            "type": "u64"
          },
          {
            "name": "tokenReserve",
            "type": "u64"
          },
          {
            "name": "vaultSol",
            "type": "u64"
          },
          {
            "name": "vaultTokens",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vaultWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "sol",
            "type": "u64"
          },
          {
            "name": "tokens",
            "type": "u64"
          },
          {
            "name": "recipient",
            "docs": [
              "The platform fee recipient that received the SOL and owns the token account."
            ],
            "type": "pubkey"
          },
          {
            "name": "recipientTokens",
            "docs": [
              "Token account (owned by `recipient`) that received the tokens."
            ],
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "venue",
      "docs": [
        "Where a launch's token trades."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "holdfast"
          },
          {
            "name": "pump"
          }
        ]
      }
    },
    {
      "name": "woundDown",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "solToBackers",
            "docs": [
              "Curve SOL + vault SOL credited to backers through the fee accumulator."
            ],
            "type": "u64"
          },
          {
            "name": "tokensReturned",
            "docs": [
              "Vault tokens moved back to the curve account."
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
