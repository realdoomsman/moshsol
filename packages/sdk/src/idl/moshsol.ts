/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/moshsol.json`.
 */
export type Moshsol = {
  "address": "C1c2ggJWMy2Ta4ogc297mGWk7Fj617dAxQr91BJKpTSW",
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
                "path": "launch.mint",
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
                "path": "launch.mint",
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
                "path": "launch.mint",
                "account": "launch"
              }
            ]
          }
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
                "path": "launch.mint",
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
                  163,
                  152,
                  41,
                  228,
                  202,
                  131,
                  135,
                  185,
                  41,
                  38,
                  96,
                  77,
                  223,
                  204,
                  204,
                  4,
                  91,
                  234,
                  128,
                  15,
                  60,
                  122,
                  79,
                  74,
                  138,
                  238,
                  227,
                  81,
                  228,
                  159,
                  200,
                  7
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
                "path": "launch.mint",
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
                "path": "launch.mint",
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
      "name": "raiseAboveBetaCap",
      "msg": "Raise maximum is above the platform's beta cap"
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
            "name": "buybackSol",
            "docs": [
              "SOL from agent sells not yet used for buy-backs. Buy-backs above average cost may only",
              "spend this budget, and only below the average agent sell price."
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
            "name": "maxRaiseLamports",
            "docs": [
              "Mainnet-beta ceiling on a launch's `raise_max`. 0 = no platform cap."
            ],
            "type": "u64"
          },
          {
            "name": "maxWalletDepositLamports",
            "docs": [
              "Mainnet-beta ceiling on any one wallet's deposit, applied on top of the creator's",
              "own cap and snapshotted into the launch at creation. 0 = no platform cap."
            ],
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
              "Blocks agent trades (circuit breaker). Vault funds stay locked either way."
            ],
            "type": "bool"
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
    }
  ]
};
