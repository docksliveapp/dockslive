import { Vehicle, VehicleCategory, VehicleType } from '../types';
import { safeAppStorage } from './storage';
import { restoreVehiclesFromIndexedDB } from './documentStorage';
import { db } from './firebase';
import { collection, getDocs } from 'firebase/firestore';

export interface VehicleTripRecord {
  id: string;
  caseNo: string;
  containerNumber?: string;
  clientName: string;
  route: string;
  date: string;
  driverName?: string;
  driverPhone?: string;
  status: string;
}

export interface VehicleRenewalRecord {
  id: number;
  renewalDate: string;
  extendedUntil: string;
  renewalCycle: string;
  authorizedBy?: string;
  notes?: string;
}

export const SEED_TRACKING_VEHICLES: Vehicle[] = [
  // 1. TLB-892: ACTIVE BONDED VEHICLE WITH MULTIPLE RENEWALS & COMPLETED TRIPS
  {
    id: 1001,
    dplSerial: 'MAK-V-0042',
    registrationNumber: 'TLB-892',
    category: VehicleCategory.BONDED_CARRIER,
    type: VehicleType.FLATBED,
    size: '40ft',
    weightCapacity: '40 Tons',
    make: 'HINO',
    maker: 'HINO MOTORS PAKISTAN',
    model: '2021',
    engineNo: 'J08E-TM99182',
    chassisNo: 'FSD-42199042',
    mra: 'LASBELA (HUB)',
    tareWeight: '14,200 KG',
    registrationDate: '2024-02-10',
    validationStartDate: '2024-02-10',
    validationExpiryDate: '2026-08-10', // Active & Valid
    operatingCompany: 'docks',
    companyName: 'Docks (Pvt.) Ltd.',
    ownerName: 'Haji Ghulam Rasool',
    ownerFatherName: 'S/O Barkhurdar Khan',
    ownerCnic: '54401-1928341-1',
    transporterId: 1,
    transporterName: 'Bilal Goods Transport Co.',
    brokerName: 'Al-Madina Freight Brokerage',
    driverName: 'Muhammad Aslam',
    driverContact: '+92-300-8273611',
    driverCnic: '42201-8931201-3',
    status: 'ON_TRIP',
    cancellationRequested: false,
    cancellationApproved: false,
    tripsHistory: [
      {
        id: 'trip_101',
        caseNo: 'DPL-26-0001',
        containerNumber: 'WHSU5957558',
        clientName: 'Alfa Textile Mills (Pvt) Ltd',
        route: 'Port Qasim, Karachi → Lahore Dry Port',
        date: '2026-03-26',
        driverName: 'Muhammad Aslam',
        driverPhone: '+92-300-8273611',
        status: 'In Transit'
      },
      {
        id: 'trip_102',
        caseNo: 'DPL-26-0018',
        containerNumber: 'MEDU9182310',
        clientName: 'Crescent Industrial Chemicals',
        route: 'KPT East Wharf → Multan Industrial Estate',
        date: '2026-02-14',
        driverName: 'Muhammad Aslam',
        driverPhone: '+92-300-8273611',
        status: 'Delivered'
      },
      {
        id: 'trip_103',
        caseNo: 'DPL-25-0891',
        containerNumber: 'MSKU4491201',
        clientName: 'Universal Poly Synthetic',
        route: 'Port Qasim → Faisalabad Dry Port',
        date: '2025-11-20',
        driverName: 'Muhammad Aslam',
        driverPhone: '+92-300-8273611',
        status: 'Delivered'
      },
      {
        id: 'trip_104',
        caseNo: 'DPL-25-0552',
        containerNumber: 'COSU6629103',
        clientName: 'Diamond Denim Fabrics',
        route: 'KPT West Wharf → Sialkot Dry Port Trust',
        date: '2025-08-15',
        driverName: 'Muhammad Aslam',
        driverPhone: '+92-300-8273611',
        status: 'Delivered'
      },
      {
        id: 'trip_105',
        caseNo: 'DPL-25-0320',
        containerNumber: 'TCLU9918230',
        clientName: 'Khurram Steel Mills',
        route: 'Port Qasim → Rawalpindi Inland Depot',
        date: '2025-05-10',
        driverName: 'Muhammad Aslam',
        driverPhone: '+92-300-8273611',
        status: 'Delivered'
      },
      {
        id: 'trip_106',
        caseNo: 'DPL-24-0992',
        containerNumber: 'CMAU7812003',
        clientName: 'National Fertilizer Marketing',
        route: 'KPT → Peshawar Dry Port',
        date: '2024-11-05',
        driverName: 'Muhammad Aslam',
        driverPhone: '+92-300-8273611',
        status: 'Delivered'
      }
    ],
    history: [
      {
        id: 1,
        date: '2024-02-10',
        description: 'Initial Fleet Registration & Customs Bonded Inspection Passed',
        type: 'STATUS_CHANGE'
      },
      {
        id: 2,
        date: '2024-08-10',
        description: '1st Bi-Annual Fleet Renewal (Validity extended to 10 Feb 2025)',
        type: 'STATUS_CHANGE'
      },
      {
        id: 3,
        date: '2025-02-10',
        description: '2nd Bi-Annual Fleet Renewal (Validity extended to 10 Aug 2025)',
        type: 'STATUS_CHANGE'
      },
      {
        id: 4,
        date: '2025-08-10',
        description: '3rd Bi-Annual Fleet Renewal (Validity extended to 10 Feb 2026)',
        type: 'STATUS_CHANGE'
      },
      {
        id: 5,
        date: '2026-02-10',
        description: '4th Bi-Annual Fleet Renewal (Validity extended to 10 Aug 2026)',
        type: 'STATUS_CHANGE'
      }
    ],
    createdAt: '2024-02-10T10:00:00.000Z'
  },

  // 2. P-9912: AFGHAN TRANSIT / BONDED CARRIER OPERATED BY TRUCKIT (PVT.) LTD
  {
    id: 1002,
    dplSerial: 'TRK-V-0019',
    registrationNumber: 'P-9912',
    category: VehicleCategory.AFGHAN_TRANSIT,
    type: VehicleType.FLATBED,
    size: '40ft',
    weightCapacity: '50 Tons',
    make: 'NISSAN DIESEL',
    maker: 'UD TRUCKS',
    model: '2019',
    engineNo: 'GE13-882190',
    chassisNo: 'CD48-992104',
    mra: 'PESHAWAR',
    tareWeight: '16,500 KG',
    registrationDate: '2024-05-18',
    validationStartDate: '2024-05-18',
    validationExpiryDate: '2026-09-18', // Active & Valid
    operatingCompany: 'truckit',
    companyName: 'Truckit (Pvt.) Ltd.',
    ownerName: 'Sher Zaman Afridi',
    ownerFatherName: 'S/O Malik Noor Zaman',
    ownerCnic: '21201-7718290-3',
    transporterId: 2,
    transporterName: 'Khyber Bonded Carriers',
    brokerName: 'Frontier Transport Logistics',
    driverName: 'Gul Khan',
    driverContact: '+92-333-9118822',
    driverCnic: '21203-8829104-5',
    status: 'ON_TRIP',
    cancellationRequested: false,
    cancellationApproved: false,
    tripsHistory: [
      {
        id: 'trip_201',
        caseNo: 'TRK-26-0044',
        containerNumber: 'TCLU8492015',
        clientName: 'Kabul Cargo Logistics & Trading',
        route: 'Karachi Port → Chaman Border Terminal',
        date: '2026-03-25',
        driverName: 'Gul Khan',
        driverPhone: '+92-333-9118822',
        status: 'In Transit'
      },
      {
        id: 'trip_202',
        caseNo: 'TRK-25-0812',
        containerNumber: 'MSKU8829104',
        clientName: 'Ariana Import Export',
        route: 'Port Qasim → Torkham Border Terminal',
        date: '2025-10-14',
        driverName: 'Gul Khan',
        driverPhone: '+92-333-9118822',
        status: 'Delivered'
      },
      {
        id: 'trip_203',
        caseNo: 'TRK-25-0391',
        containerNumber: 'TGHU7718201',
        clientName: 'Afghan United Logistics',
        route: 'Karachi Port → Chaman Custom Yard',
        date: '2025-04-18',
        driverName: 'Gul Khan',
        driverPhone: '+92-333-9118822',
        status: 'Delivered'
      }
    ],
    history: [
      {
        id: 11,
        date: '2024-05-18',
        description: 'Afghan Transit Carrier Enrolment & Tracker Installed',
        type: 'STATUS_CHANGE'
      },
      {
        id: 12,
        date: '2024-11-18',
        description: '1st Bi-Annual Renewal (Valid until 18 May 2025)',
        type: 'STATUS_CHANGE'
      },
      {
        id: 13,
        date: '2025-05-18',
        description: '2nd Bi-Annual Renewal (Valid until 18 Nov 2025)',
        type: 'STATUS_CHANGE'
      },
      {
        id: 14,
        date: '2025-11-18',
        description: '3rd Bi-Annual Renewal (Valid until 18 May 2026)',
        type: 'STATUS_CHANGE'
      },
      {
        id: 15,
        date: '2026-03-18',
        description: '4th Bi-Annual Renewal (Valid until 18 Sep 2026)',
        type: 'STATUS_CHANGE'
      }
    ],
    createdAt: '2024-05-18T11:00:00.000Z'
  },

  // 3. KHI-7721: CANCELLED / DEREGISTERED VEHICLE (NOC ISSUED)
  // Demonstrates user brief: "ya NOC issue ho chuki hai kya matlab cancel ho chuki hai"
  {
    id: 1003,
    dplSerial: 'MAK-V-0012',
    registrationNumber: 'KHI-7721',
    category: VehicleCategory.BONDED_CARRIER,
    type: VehicleType.FLATBED,
    size: '40ft',
    weightCapacity: '35 Tons',
    make: 'BEDFORD',
    maker: 'BEDFORD MOTORS',
    model: '2016',
    engineNo: 'BF-7718290',
    chassisNo: 'CH-9921820',
    mra: 'KARACHI',
    tareWeight: '13,800 KG',
    registrationDate: '2023-06-15',
    validationStartDate: '2023-06-15',
    validationExpiryDate: '2025-02-18',
    operatingCompany: 'docks',
    companyName: 'Docks (Pvt.) Ltd.',
    ownerName: 'Mian Bashir Ahmed',
    ownerFatherName: 'S/O Fazal Karim',
    ownerCnic: '42301-7718290-1',
    transporterId: 3,
    transporterName: 'Al-Makkah Transport Network',
    brokerName: 'Karachi Goods Association',
    driverName: 'Abdul Sattar',
    driverContact: '+92-321-4455881',
    driverCnic: '42101-9928172-5',
    status: 'CANCELLED', // Cancelled / Deregistered
    cancellationRequested: true,
    cancellationApproved: true,
    cancellationDate: '2025-02-18',
    cancellationReason: 'Voluntary Deregistration. Fleet vehicle sold and transferred to non-bonded general haulage.',
    nocReference: 'NOC-MAK-2025-0419',
    nocDate: '2025-02-18',
    tripsHistory: [
      {
        id: 'trip_301',
        caseNo: 'DPL-25-0142',
        containerNumber: 'WHSU5957558',
        clientName: 'Alfa Textile Mills (Pvt) Ltd',
        route: 'Karachi Port → Lahore Dry Port',
        date: '2025-01-14',
        driverName: 'Abdul Sattar',
        driverPhone: '+92-321-4455881',
        status: 'Delivered'
      },
      {
        id: 'trip_302',
        caseNo: 'DPL-24-0619',
        containerNumber: 'MSKU3319021',
        clientName: 'Chenab Fabrics',
        route: 'Port Qasim → Faisalabad',
        date: '2024-09-12',
        driverName: 'Abdul Sattar',
        driverPhone: '+92-321-4455881',
        status: 'Delivered'
      }
    ],
    history: [
      {
        id: 21,
        date: '2023-06-15',
        description: 'Bonded Carrier Enrolment Authorized',
        type: 'STATUS_CHANGE'
      },
      {
        id: 22,
        date: '2023-12-15',
        description: '1st Bi-Annual Renewal',
        type: 'STATUS_CHANGE'
      },
      {
        id: 23,
        date: '2024-06-15',
        description: '2nd Bi-Annual Renewal',
        type: 'STATUS_CHANGE'
      },
      {
        id: 24,
        date: '2024-12-15',
        description: '3rd Bi-Annual Renewal',
        type: 'STATUS_CHANGE'
      },
      {
        id: 25,
        date: '2025-02-18',
        description: 'Official De-registration & No Objection Certificate (NOC-MAK-2025-0419) Issued',
        type: 'STATUS_CHANGE'
      }
    ],
    createdAt: '2023-06-15T09:00:00.000Z'
  },

  // 4. JU-4412: EXPIRED VEHICLE (VALIDATION OVERDUE)
  // Demonstrates user brief: "yeah expire hai"
  {
    id: 1004,
    dplSerial: 'MAK-V-0038',
    registrationNumber: 'JU-4412',
    category: VehicleCategory.BONDED_CARRIER,
    type: VehicleType.LOWBED,
    size: '40ft',
    weightCapacity: '55 Tons',
    make: 'VOLVO',
    maker: 'VOLVO TRUCKS',
    model: '2018',
    engineNo: 'D13A-991204',
    chassisNo: 'YV2-7718290',
    mra: 'LASBELA (HUB)',
    tareWeight: '17,200 KG',
    registrationDate: '2024-01-10',
    validationStartDate: '2024-01-10',
    validationExpiryDate: '2025-11-10', // Past Date = EXPIRED
    operatingCompany: 'docks',
    companyName: 'Docks (Pvt.) Ltd.',
    ownerName: 'Noor Muhammad Jamali',
    ownerFatherName: 'S/O Dost Muhammad Jamali',
    ownerCnic: '54401-8819201-9',
    transporterId: 4,
    transporterName: 'Lasbela Heavy Equipment Haulage',
    brokerName: 'Hub Logistics Union',
    driverName: 'Noor Muhammad',
    driverContact: '+92-311-2299881',
    driverCnic: '54402-9918231-7',
    status: 'EXPIRED', // Expired
    cancellationRequested: false,
    cancellationApproved: false,
    tripsHistory: [
      {
        id: 'trip_401',
        caseNo: 'DPL-25-0441',
        containerNumber: 'GLDU8819203',
        clientName: 'Hub Power Services',
        route: 'Port Qasim → Hub Industrial Zone',
        date: '2025-06-20',
        driverName: 'Noor Muhammad',
        driverPhone: '+92-311-2299881',
        status: 'Delivered'
      }
    ],
    history: [
      {
        id: 31,
        date: '2024-01-10',
        description: 'Heavy Fleet Enrolment',
        type: 'STATUS_CHANGE'
      },
      {
        id: 32,
        date: '2024-07-10',
        description: '1st Bi-Annual Renewal',
        type: 'STATUS_CHANGE'
      },
      {
        id: 33,
        date: '2025-01-10',
        description: '2nd Bi-Annual Renewal (Expired on 10 Nov 2025)',
        type: 'STATUS_CHANGE'
      }
    ],
    createdAt: '2024-01-10T08:00:00.000Z'
  }
];

const VEHICLE_STORAGE_KEYS = [
  'dpl_live_vehicles',
  'dpl_cached_vehicles'
];

/**
 * Gathers all registered vehicles from:
 * 1. LocalStorage across all partitions
 * 2. IndexedDB backups
 * 3. Firestore 'vehicles' collection
 * 4. High-fidelity demo seeds
 */
export async function fetchAllTrackingVehicles(): Promise<Vehicle[]> {
  const mergedMap = new Map<string, Vehicle>();

  // 1. Seed with reference vehicles
  SEED_TRACKING_VEHICLES.forEach((v) => {
    const reg = v.registrationNumber?.trim().toUpperCase();
    if (reg) mergedMap.set(reg, v);
  });

  // 2. Read from localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    VEHICLE_STORAGE_KEYS.forEach((key) => {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            parsed.forEach((v: Vehicle) => {
              const reg = v.registrationNumber?.trim().toUpperCase();
              if (reg) {
                const existing = mergedMap.get(reg);
                if (!existing) {
                  mergedMap.set(reg, v);
                } else {
                  mergedMap.set(reg, { ...existing, ...v });
                }
              }
            });
          }
        }
      } catch (_) {}
    });
  }

  // 3. Read from IndexedDB
  try {
    const idbVehicles = await restoreVehiclesFromIndexedDB();
    if (Array.isArray(idbVehicles)) {
      idbVehicles.forEach((v: Vehicle) => {
        const reg = v.registrationNumber?.trim().toUpperCase();
        if (reg) {
          const existing = mergedMap.get(reg);
          if (!existing) {
            mergedMap.set(reg, v);
          } else {
            mergedMap.set(reg, { ...existing, ...v });
          }
        }
      });
    }
  } catch (_) {}

  // 4. Read from Firestore
  try {
    const snap = await getDocs(collection(db, 'vehicles'));
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Vehicle;
      const reg = data.registrationNumber?.trim().toUpperCase();
      if (reg) {
        const existing = mergedMap.get(reg);
        if (!existing) {
          mergedMap.set(reg, { ...data, id: Number(docSnap.id) || Date.now() });
        } else {
          mergedMap.set(reg, { ...existing, ...data });
        }
      }
    });
  } catch (_) {}

  return Array.from(mergedMap.values());
}

/**
 * Searches vehicles by registration number or plate digits.
 * User requirement: "Jo bhi vehicle number likha jaega use number se kitne ki vehicles hongi woh neeche a jaayengi"
 */
export function searchTrackingVehicles(query: string, allVehicles: Vehicle[]): Vehicle[] {
  if (!query) return [];
  const cleanQ = query.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
  if (!cleanQ) return [];

  return allVehicles.filter((v) => {
    // 1. Registration Plate match
    const reg = (v.registrationNumber || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (reg.includes(cleanQ) || cleanQ.includes(reg)) return true;

    // 2. DPL Serial match (e.g. MAK-V-0042)
    const serial = (v.dplSerial || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (serial.includes(cleanQ) || cleanQ.includes(serial)) return true;

    // 3. Engine / Chassis No match
    const eng = (v.engineNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const chs = (v.chassisNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (eng.includes(cleanQ) || chs.includes(cleanQ)) return true;

    // 4. Transporter Name match
    const transp = (v.transporterName || '').toLowerCase();
    if (transp.includes(query.toLowerCase().trim())) return true;

    return false;
  });
}
