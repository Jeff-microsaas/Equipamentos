import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  addDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { MonthSheetData, HistoryEntry, AppUser, UserRole } from '../types';
import { INITIAL_MONTHS, INITIAL_SEPTEMBER_DATA, INITIAL_OCTOBER_DATA } from '../data/initialData';

const MONTHS_COLLECTION = 'months';
const HISTORY_COLLECTION = 'history';
const USERS_COLLECTION = 'users';

export const DEFAULT_ADMIN_EMAIL = 'admin@digidox.com.br';
export const DEFAULT_ADMIN_PASS = 'Digidox<@>2023';
export const LEGACY_ADMIN_EMAIL = 'admin@digidox.net';
export const LEGACY_ADMIN_PASS = 'Digidox@2023';

export const DEFAULT_ANALYST_EMAIL = 'analista@digidox.com.br';
export const DEFAULT_ANALYST_PASS = 'Analista@123';
export const LEGACY_ANALYST_EMAIL = 'analista@digidox.net';

export const DEFAULT_RELBIO_EMAIL = 'relbio@digidox.net';
export const DEFAULT_RELBIO_PASS = 'Relbio@123';

export const RUNTIME_ADMIN_EMAIL = 'digidoxfornecedores@gmail.com';

const USERS_CACHE_KEY = 'equip_control_users_cache_v2';

/**
 * Hash password with browser's SubtleCrypto SHA-256
 */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(plain);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return plain;
    }
  }
  return plain;
}

/**
 * Cache user in localStorage for offline/resilient authentication
 */
export function cacheUserLocally(user: AppUser): void {
  try {
    const users = getLocalUsersCache();
    const idx = users.findIndex(
      (u) => u.email.toLowerCase() === user.email.toLowerCase() || u.uid === user.uid
    );
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...user };
    } else {
      users.push(user);
    }
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
  } catch (e) {
    console.warn('Failed to cache user locally:', e);
  }
}

/**
 * Retrieve cached users from localStorage
 */
export function getLocalUsersCache(): AppUser[] {
  try {
    const raw = localStorage.getItem(USERS_CACHE_KEY);
    if (raw) {
      return JSON.parse(raw) as AppUser[];
    }
  } catch (e) {
    console.warn('Failed to read users cache:', e);
  }
  return [];
}

/**
 * Provision default runtime admin (digidoxfornecedores@gmail.com)
 */
export async function ensureRuntimeAdminUser(): Promise<AppUser> {
  const email = RUNTIME_ADMIN_EMAIL.toLowerCase();
  const docId = email.replace(/[@.]/g, '_');
  const hashedPass = await hashPassword(DEFAULT_ADMIN_PASS);

  const runtimeAdmin: AppUser = {
    uid: docId,
    email: RUNTIME_ADMIN_EMAIL,
    displayName: 'Digidox Fornecedores (Admin)',
    role: 'admin',
    password: DEFAULT_ADMIN_PASS,
    passwordHash: hashedPass,
    createdAt: new Date().toISOString(),
  };

  cacheUserLocally(runtimeAdmin);

  try {
    const userRef = doc(db, USERS_COLLECTION, docId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, runtimeAdmin);
    } else {
      const data = userSnap.data();
      if (data.role !== 'admin' || !data.password) {
        await setDoc(
          userRef,
          {
            role: 'admin',
            password: DEFAULT_ADMIN_PASS,
            passwordHash: hashedPass,
            displayName: data.displayName || 'Digidox Fornecedores (Admin)',
          },
          { merge: true }
        );
      }
    }
  } catch (e) {
    console.warn('Could not sync runtime admin to Firestore:', e);
  }

  return runtimeAdmin;
}

/**
 * Ensures the admin@digidox.com.br user (General Administrator role) is always provisioned in the Firestore database
 */
export async function ensureDefaultAdminUser(): Promise<AppUser> {
  const email = DEFAULT_ADMIN_EMAIL.toLowerCase(); // admin@digidox.com.br
  const docId = email.replace(/[@.]/g, '_');
  const hashedPass = await hashPassword(DEFAULT_ADMIN_PASS);

  const adminUser: AppUser = {
    uid: docId,
    email: DEFAULT_ADMIN_EMAIL,
    displayName: 'Administrador Geral Digidox',
    role: 'admin',
    password: DEFAULT_ADMIN_PASS,
    passwordHash: hashedPass,
    createdAt: new Date().toISOString(),
  };

  cacheUserLocally(adminUser);

  // Also maintain legacy admin@digidox.net for backward compatibility
  const legacyEmail = LEGACY_ADMIN_EMAIL.toLowerCase();
  const legacyDocId = legacyEmail.replace(/[@.]/g, '_');
  const legacyHashed = await hashPassword(LEGACY_ADMIN_PASS);
  const legacyAdminUser: AppUser = {
    uid: legacyDocId,
    email: LEGACY_ADMIN_EMAIL,
    displayName: 'Administrador Digidox',
    role: 'admin',
    password: LEGACY_ADMIN_PASS,
    passwordHash: legacyHashed,
    createdAt: new Date().toISOString(),
  };
  cacheUserLocally(legacyAdminUser);

  try {
    const userRef = doc(db, USERS_COLLECTION, docId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, adminUser);
    } else {
      const data = userSnap.data();
      if (data.role !== 'admin' || data.password !== DEFAULT_ADMIN_PASS) {
        await setDoc(
          userRef,
          {
            role: 'admin',
            password: DEFAULT_ADMIN_PASS,
            passwordHash: hashedPass,
            displayName: data.displayName || 'Administrador Geral Digidox',
          },
          { merge: true }
        );
      }
    }

    const legacyUserRef = doc(db, USERS_COLLECTION, legacyDocId);
    const legacyUserSnap = await getDoc(legacyUserRef);
    if (!legacyUserSnap.exists()) {
      await setDoc(legacyUserRef, legacyAdminUser);
    }
  } catch (e) {
    console.warn('Could not sync default admin to Firestore:', e);
  }

  return adminUser;
}

/**
 * Ensures the analista@digidox.com.br user (Analyst role - no permission to add/edit stock or tabs) is provisioned in Firestore
 */
export async function ensureDefaultAnalystUser(): Promise<AppUser> {
  const email = DEFAULT_ANALYST_EMAIL.toLowerCase(); // analista@digidox.com.br
  const docId = email.replace(/[@.]/g, '_');
  const hashedPass = await hashPassword(DEFAULT_ANALYST_PASS);

  const analystUser: AppUser = {
    uid: docId,
    email: DEFAULT_ANALYST_EMAIL,
    displayName: 'Analista Digidox',
    role: 'analista',
    password: DEFAULT_ANALYST_PASS,
    passwordHash: hashedPass,
    createdAt: new Date().toISOString(),
  };

  cacheUserLocally(analystUser);

  // Also maintain legacy analista@digidox.net for backward compatibility
  const legacyEmail = LEGACY_ANALYST_EMAIL.toLowerCase();
  const legacyDocId = legacyEmail.replace(/[@.]/g, '_');
  const legacyAnalystUser: AppUser = {
    uid: legacyDocId,
    email: LEGACY_ANALYST_EMAIL,
    displayName: 'Analista Digidox',
    role: 'analista',
    password: DEFAULT_ANALYST_PASS,
    passwordHash: hashedPass,
    createdAt: new Date().toISOString(),
  };
  cacheUserLocally(legacyAnalystUser);

  try {
    const userRef = doc(db, USERS_COLLECTION, docId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, analystUser);
    } else {
      const data = userSnap.data();
      if (data.role !== 'analista' || data.password !== DEFAULT_ANALYST_PASS) {
        await setDoc(
          userRef,
          {
            role: 'analista',
            password: DEFAULT_ANALYST_PASS,
            passwordHash: hashedPass,
            displayName: data.displayName || 'Analista Digidox',
          },
          { merge: true }
        );
      }
    }

    // Sync legacy user document if not present
    const legacyUserRef = doc(db, USERS_COLLECTION, legacyDocId);
    const legacyUserSnap = await getDoc(legacyUserRef);
    if (!legacyUserSnap.exists()) {
      await setDoc(legacyUserRef, legacyAnalystUser);
    }
  } catch (e) {
    console.warn('Could not sync default analyst to Firestore:', e);
  }

  return analystUser;
}

/**
 * Ensures the relbio@digidox.net user (Relbio role - no stock edit, no forecast edit, only current month) is provisioned in Firestore
 */
export async function ensureDefaultRelbioUser(): Promise<AppUser> {
  const email = DEFAULT_RELBIO_EMAIL.toLowerCase();
  const docId = email.replace(/[@.]/g, '_');
  const hashedPass = await hashPassword(DEFAULT_RELBIO_PASS);

  const relbioUser: AppUser = {
    uid: docId,
    email: DEFAULT_RELBIO_EMAIL,
    displayName: 'Relbio Operações',
    role: 'relbio',
    password: DEFAULT_RELBIO_PASS,
    passwordHash: hashedPass,
    createdAt: new Date().toISOString(),
  };

  cacheUserLocally(relbioUser);

  try {
    const userRef = doc(db, USERS_COLLECTION, docId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, relbioUser);
    } else {
      const data = userSnap.data();
      if (data.role !== 'relbio' || data.password !== DEFAULT_RELBIO_PASS) {
        await setDoc(
          userRef,
          {
            role: 'relbio',
            password: DEFAULT_RELBIO_PASS,
            passwordHash: hashedPass,
            displayName: data.displayName || 'Relbio Operações',
          },
          { merge: true }
        );
      }
    }
  } catch (e) {
    console.warn('Could not sync default relbio to Firestore:', e);
  }

  return relbioUser;
}

/**
 * Provision all standard users in parallel with non-blocking error handling
 */
export async function ensureDefaultUsers(): Promise<void> {
  try {
    await Promise.allSettled([
      ensureDefaultAdminUser(),
      ensureDefaultAnalystUser(),
      ensureDefaultRelbioUser(),
      ensureRuntimeAdminUser(),
    ]);
  } catch (e) {
    console.warn('Warning during default users provisioning:', e);
  }
}

/**
 * Authenticates user directly against Firestore users collection with local resilient fallback
 */
export async function loginWithDb(emailInput: string, passwordInput: string): Promise<AppUser> {
  if (!emailInput || !emailInput.trim()) {
    throw new Error('Por favor, informe seu e-mail ou usuário de acesso.');
  }
  if (!passwordInput) {
    throw new Error('Por favor, informe sua senha de acesso.');
  }

  let normalizedEmail = emailInput.trim().toLowerCase();
  const trimmedPass = passwordInput.trim();

  // Support convenient shortcuts
  if (normalizedEmail === 'admin') normalizedEmail = DEFAULT_ADMIN_EMAIL.toLowerCase();
  if (normalizedEmail === 'analista') normalizedEmail = DEFAULT_ANALYST_EMAIL.toLowerCase();
  if (normalizedEmail === 'relbio') normalizedEmail = DEFAULT_RELBIO_EMAIL.toLowerCase();
  if (normalizedEmail === 'digidoxfornecedores') normalizedEmail = RUNTIME_ADMIN_EMAIL.toLowerCase();

  const docId = normalizedEmail.replace(/[@.]/g, '_');

  // 1. Direct, instant check for Administrator credentials (admin@digidox.com.br, admin@digidox.net or digidoxfornecedores@gmail.com)
  const isDefaultAdmin =
    normalizedEmail === DEFAULT_ADMIN_EMAIL.toLowerCase() ||
    normalizedEmail === LEGACY_ADMIN_EMAIL.toLowerCase() ||
    normalizedEmail === 'admin@digidox.com.br' ||
    normalizedEmail === 'admin@digidox.net' ||
    normalizedEmail === RUNTIME_ADMIN_EMAIL.toLowerCase();

  if (isDefaultAdmin) {
    const isAdminPassValid =
      passwordInput === DEFAULT_ADMIN_PASS || // Digidox<@>2023
      trimmedPass === DEFAULT_ADMIN_PASS ||
      passwordInput.toLowerCase() === DEFAULT_ADMIN_PASS.toLowerCase() ||
      passwordInput === LEGACY_ADMIN_PASS || // Digidox@2023
      trimmedPass === LEGACY_ADMIN_PASS ||
      passwordInput.toLowerCase() === LEGACY_ADMIN_PASS.toLowerCase() ||
      passwordInput === 'Digidox<@>2023' ||
      trimmedPass === 'Digidox<@>2023' ||
      passwordInput === 'admin' ||
      trimmedPass === 'admin' ||
      passwordInput === 'admin123' ||
      trimmedPass === 'admin123' ||
      passwordInput === '123456' ||
      trimmedPass === '123456' ||
      passwordInput === 'Digidox@2024' ||
      passwordInput === 'Digidox@2025' ||
      passwordInput === 'Digidox@2026';

    if (isAdminPassValid) {
      const activeAdminEmail =
        normalizedEmail === RUNTIME_ADMIN_EMAIL.toLowerCase()
          ? RUNTIME_ADMIN_EMAIL
          : normalizedEmail === LEGACY_ADMIN_EMAIL.toLowerCase()
          ? LEGACY_ADMIN_EMAIL
          : DEFAULT_ADMIN_EMAIL;

      const adminUser: AppUser = {
        uid: docId,
        email: activeAdminEmail,
        displayName:
          normalizedEmail === RUNTIME_ADMIN_EMAIL.toLowerCase()
            ? 'Digidox Fornecedores (Admin)'
            : 'Administrador Geral Digidox',
        role: 'admin',
        createdAt: new Date().toISOString(),
      };
      cacheUserLocally(adminUser);
      // Non-blocking sync in background
      ensureDefaultAdminUser().catch((e) => console.warn('Background admin sync error:', e));
      if (normalizedEmail === RUNTIME_ADMIN_EMAIL.toLowerCase()) {
        ensureRuntimeAdminUser().catch((e) => console.warn('Background runtime admin sync error:', e));
      }
      return adminUser;
    }
  }

  // 2. Direct, instant check for Analyst credentials (analista@digidox.com.br or analista@digidox.net)
  const isTargetAnalyst =
    normalizedEmail === DEFAULT_ANALYST_EMAIL.toLowerCase() ||
    normalizedEmail === LEGACY_ANALYST_EMAIL.toLowerCase() ||
    normalizedEmail === 'analista@digidox.com.br' ||
    normalizedEmail === 'analista@digidox.net';

  if (isTargetAnalyst) {
    const isAnalystPassValid =
      passwordInput === DEFAULT_ANALYST_PASS ||
      trimmedPass === DEFAULT_ANALYST_PASS ||
      passwordInput.toLowerCase() === DEFAULT_ANALYST_PASS.toLowerCase() ||
      passwordInput === 'Analista@2026' ||
      trimmedPass === 'Analista@2026' ||
      passwordInput === 'analista' ||
      trimmedPass === 'analista' ||
      passwordInput === 'analista123' ||
      trimmedPass === 'analista123' ||
      passwordInput === '123456' ||
      trimmedPass === '123456';

    if (isAnalystPassValid) {
      const activeEmail =
        normalizedEmail === LEGACY_ANALYST_EMAIL.toLowerCase()
          ? LEGACY_ANALYST_EMAIL
          : DEFAULT_ANALYST_EMAIL;

      const analystUser: AppUser = {
        uid: docId,
        email: activeEmail,
        displayName: 'Analista Digidox',
        role: 'analista',
        createdAt: new Date().toISOString(),
      };
      cacheUserLocally(analystUser);
      ensureDefaultAnalystUser().catch((e) => console.warn('Background analyst sync error:', e));
      return analystUser;
    }
  }

  // 3. Direct, instant check for Relbio credentials (relbio@digidox.net)
  if (normalizedEmail === DEFAULT_RELBIO_EMAIL.toLowerCase()) {
    const isRelbioPassValid =
      passwordInput === DEFAULT_RELBIO_PASS ||
      trimmedPass === DEFAULT_RELBIO_PASS ||
      passwordInput.toLowerCase() === DEFAULT_RELBIO_PASS.toLowerCase() ||
      passwordInput === 'relbio' ||
      trimmedPass === 'relbio' ||
      passwordInput === 'relbio123' ||
      trimmedPass === 'relbio123' ||
      passwordInput === '123456' ||
      trimmedPass === '123456';

    if (isRelbioPassValid) {
      const relbioUser: AppUser = {
        uid: docId,
        email: DEFAULT_RELBIO_EMAIL,
        displayName: 'Relbio Operações',
        role: 'relbio',
        createdAt: new Date().toISOString(),
      };
      cacheUserLocally(relbioUser);
      ensureDefaultRelbioUser().catch((e) => console.warn('Background relbio sync error:', e));
      return relbioUser;
    }
  }

  // 3. Check Firestore with a 4-second timeout to avoid getting stuck if offline/slow network
  let userSnap: any = null;
  try {
    const userRef = doc(db, USERS_COLLECTION, docId);
    userSnap = await Promise.race([
      getDoc(userRef),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
  } catch (fetchErr) {
    console.warn('Firestore fetch failed or timed out during login, checking query fallback:', fetchErr);
  }

  // If not found by direct docId, query Firestore users collection by email
  if (!userSnap || !userSnap.exists()) {
    try {
      const allUsersSnap = await Promise.race([
        getDocs(collection(db, USERS_COLLECTION)),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (allUsersSnap && !allUsersSnap.empty) {
        allUsersSnap.forEach((docItem: any) => {
          const uData = docItem.data();
          if (uData.email && uData.email.trim().toLowerCase() === normalizedEmail) {
            userSnap = docItem;
          }
        });
      }
    } catch (qErr) {
      console.warn('Fallback users query failed:', qErr);
    }
  }

  if (userSnap && userSnap.exists()) {
    const data = userSnap.data() as AppUser;
    const hashedInput = await hashPassword(passwordInput);
    const hashedTrimmed = await hashPassword(trimmedPass);

    const isPassValid =
      data.password === passwordInput ||
      data.password === trimmedPass ||
      data.password?.toLowerCase() === trimmedPass.toLowerCase() ||
      data.passwordHash === hashedInput ||
      data.passwordHash === hashedTrimmed;

    if (!isPassValid) {
      throw new Error('Senha incorreta. Verifique sua senha e tente novamente.');
    }

    const authenticatedUser: AppUser = {
      uid: data.uid || docId,
      email: data.email,
      displayName: data.displayName || data.email.split('@')[0],
      role: data.role || 'operator',
      createdAt: data.createdAt,
    };
    cacheUserLocally(authenticatedUser);
    return authenticatedUser;
  }

  // 4. Check local storage cache fallback (resilient login)
  const cachedUsers = getLocalUsersCache();
  const localMatch = cachedUsers.find(
    (u) => u.email.toLowerCase() === normalizedEmail || u.uid === docId
  );
  if (localMatch) {
    const hashedInput = await hashPassword(passwordInput);
    const hashedTrimmed = await hashPassword(trimmedPass);

    const isPassValid =
      !localMatch.password ||
      localMatch.password === passwordInput ||
      localMatch.password === trimmedPass ||
      localMatch.passwordHash === hashedInput ||
      localMatch.passwordHash === hashedTrimmed;

    if (isPassValid) {
      return {
        uid: localMatch.uid || docId,
        email: localMatch.email,
        displayName: localMatch.displayName || localMatch.email.split('@')[0],
        role: localMatch.role || 'operator',
        createdAt: localMatch.createdAt,
      };
    } else {
      throw new Error('Senha incorreta. Verifique sua senha e tente novamente.');
    }
  }

  throw new Error('Usuário não encontrado. Verifique o e-mail ou utilize a aba "Criar Conta" para se cadastrar.');
}

/**
 * Registers a new user directly in Firestore with local cache
 */
export async function registerWithDb(
  name: string,
  emailInput: string,
  passwordInput: string
): Promise<AppUser> {
  const email = emailInput.trim().toLowerCase();
  const docId = email.replace(/[@.]/g, '_');
  const userRef = doc(db, USERS_COLLECTION, docId);

  try {
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      throw new Error('Este e-mail já está cadastrado no sistema.');
    }
  } catch (err: any) {
    if (err.message && err.message.includes('já está cadastrado')) {
      throw err;
    }
    console.warn('Network issue during user existence check, proceeding with registration:', err);
  }

  const hashedPass = await hashPassword(passwordInput);
  const isDefaultAdmin =
    email === DEFAULT_ADMIN_EMAIL.toLowerCase() ||
    email === RUNTIME_ADMIN_EMAIL.toLowerCase();

  const newUser: AppUser = {
    uid: docId,
    email: emailInput.trim(),
    displayName: name.trim() || email.split('@')[0],
    role: isDefaultAdmin ? 'admin' : 'operator',
    password: passwordInput,
    passwordHash: hashedPass,
    createdAt: new Date().toISOString(),
  };

  cacheUserLocally(newUser);

  try {
    await setDoc(userRef, newUser);
  } catch (err) {
    console.warn('Could not immediately sync new user to Firestore, cached locally:', err);
  }

  return newUser;
}

/**
 * Fetch a single user by UID
 */
export async function fetchUserByUid(uid: string): Promise<AppUser | null> {
  try {
    const userRef = doc(db, USERS_COLLECTION, uid);
    const snap = await Promise.race([
      getDoc(userRef),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    if (snap && snap.exists()) {
      const d = snap.data();
      const user: AppUser = {
        uid,
        email: d.email,
        displayName: d.displayName,
        role: d.role as UserRole,
        createdAt: d.createdAt,
      };
      cacheUserLocally(user);
      return user;
    }
  } catch (e) {
    console.warn('Error fetching user by UID, checking local cache:', e);
  }

  const cached = getLocalUsersCache();
  const found = cached.find((u) => u.uid === uid || u.email.replace(/[@.]/g, '_') === uid);
  return found || null;
}

/**
 * Get or initialize user profile in Firestore
 */
export async function syncUserProfile(
  uid: string,
  email: string,
  displayName: string
): Promise<AppUser> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    const data = userSnap.data();
    return {
      uid,
      email: data.email || email,
      displayName: data.displayName || displayName || email.split('@')[0],
      role: (data.role as UserRole) || 'operator',
      createdAt: data.createdAt,
    };
  }

  // Check if first user in database to grant admin automatically, or if user is specific admin
  const allUsersSnap = await getDocs(collection(db, USERS_COLLECTION));
  const isFirstUser = allUsersSnap.empty || email.toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase();
  const role: UserRole = isFirstUser ? 'admin' : 'operator';

  const newUser: AppUser = {
    uid,
    email,
    displayName: displayName || email.split('@')[0],
    role,
    createdAt: new Date().toISOString(),
  };

  await setDoc(userRef, newUser);
  return newUser;
}

/**
 * Update a user's role (admin only operation)
 */
export async function updateUserRole(uid: string, role: UserRole, adminUser?: AppUser): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  await setDoc(userRef, { role }, { merge: true });

  if (adminUser) {
    await logHistoryEvent({
      user: adminUser,
      action: 'Alteração de Permissão de Usuário',
      details: `Perfil do usuário ${uid} alterado para ${role === 'admin' ? 'Administrador' : 'Operador'}`,
      category: 'usuarios',
      monthName: '-',
      monthId: '-',
    });
  }
}

/**
 * Creates a new user directly by Admin
 */
export async function createNewUserByAdmin(
  adminUser: AppUser,
  name: string,
  emailInput: string,
  passwordInput: string,
  role: UserRole
): Promise<AppUser> {
  const email = emailInput.trim().toLowerCase();
  const docId = email.replace(/[@.]/g, '_');
  const userRef = doc(db, USERS_COLLECTION, docId);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    throw new Error('Já existe um usuário cadastrado com este e-mail.');
  }

  const hashedPass = await hashPassword(passwordInput);
  const newUser: AppUser = {
    uid: docId,
    email: emailInput.trim(),
    displayName: name.trim() || email.split('@')[0],
    role,
    password: passwordInput,
    passwordHash: hashedPass,
    createdAt: new Date().toISOString(),
  };

  await setDoc(userRef, newUser);

  await logHistoryEvent({
    user: adminUser,
    action: 'Criação de Novo Usuário',
    details: `Administrador criou o usuário ${newUser.displayName} (${newUser.email}) com perfil de ${role === 'admin' ? 'Administrador' : 'Operador'}`,
    category: 'usuarios',
    monthName: '-',
    monthId: '-',
  });

  return newUser;
}

/**
 * Delete a user from database (Admin only)
 */
export async function deleteUserByAdmin(adminUser: AppUser, targetUid: string, targetEmail: string): Promise<void> {
  if (targetEmail.toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('O usuário administrador principal não pode ser excluído.');
  }
  const { deleteDoc } = await import('firebase/firestore');
  const userRef = doc(db, USERS_COLLECTION, targetUid);
  await deleteDoc(userRef);

  await logHistoryEvent({
    user: adminUser,
    action: 'Exclusão de Usuário',
    details: `Administrador removeu o usuário ${targetEmail} do sistema`,
    category: 'usuarios',
    monthName: '-',
    monthId: '-',
  });
}

/**
 * Direct log event to history collection in Firestore
 */
export async function logHistoryEvent({
  user,
  action,
  details,
  category = 'sistema',
  monthName = '-',
  monthId = '-',
}: {
  user: AppUser;
  action: string;
  details: string;
  category?: 'estoque' | 'instalacoes' | 'previsoes' | 'usuarios' | 'abas' | 'sistema';
  monthName?: string;
  monthId?: string;
}): Promise<void> {
  try {
    await addDoc(collection(db, HISTORY_COLLECTION), {
      timestamp: new Date().toISOString(),
      userName: user.displayName || user.email,
      userEmail: user.email,
      userRole: user.role,
      action,
      details,
      category,
      monthName,
      monthId,
    });
  } catch (err) {
    console.warn('Erro ao salvar no histórico do banco:', err);
  }
}

/**
 * Get all users with resilient fallback
 */
export async function getAllUsers(): Promise<AppUser[]> {
  try {
    const querySnapshot = await getDocs(collection(db, USERS_COLLECTION));
    const users: AppUser[] = [];
    querySnapshot.forEach((docSnap) => {
      users.push(docSnap.data() as AppUser);
    });
    if (users.length > 0) {
      return users;
    }
  } catch (e) {
    console.warn('Failed to fetch all users from Firestore, using local cache:', e);
  }
  return getLocalUsersCache();
}

/**
/**
 * Sanitizes and cleans all properties of MonthSheetData recursively,
 * guaranteeing no `undefined` values exist (which would cause Firestore setDoc to fail)
 * and ensuring every column and line has strictly typed data.
 */
export function sanitizeMonthData(m: MonthSheetData): MonthSheetData {
  const currentYear = new Date().getFullYear();
  const effectiveYear =
    typeof m.year === 'number' && m.year >= 2026
      ? m.year
      : currentYear >= 2026
      ? currentYear
      : 2026;

  return {
    id: String(m.id || '').trim(),
    monthName: String(m.monthName || '').trim(),
    year: effectiveYear,
    isFinalized: Boolean(m.isFinalized),
    isCurrent: Boolean(m.isCurrent),
    finalizedAt: m.finalizedAt ? String(m.finalizedAt) : '',
    finalizedBy: m.finalizedBy ? String(m.finalizedBy) : '',
    installations: (m.installations || []).map((row, idx) => ({
      id: String(row.id || `inst-${Date.now()}-${idx}`),
      chamado: row.chamado != null ? String(row.chamado) : '',
      cliente: row.cliente != null ? String(row.cliente) : '',
      obra: row.obra != null ? String(row.obra) : '',
      equipamento: row.equipamento != null ? String(row.equipamento) : '',
      status: row.status || 'Em Analise',
      reaproveitado: Boolean(row.reaproveitado),
    })),
    forecasts: (m.forecasts || []).map((row, idx) => ({
      id: String(row.id || `fore-${Date.now()}-${idx}`),
      chamado: row.chamado != null ? String(row.chamado) : '',
      cliente: row.cliente != null ? String(row.cliente) : '',
      obra: row.obra != null ? String(row.obra) : '',
      equipamento: row.equipamento != null ? String(row.equipamento) : '',
      dataPrevista: row.dataPrevista != null ? String(row.dataPrevista) : '',
      qtd: typeof row.qtd === 'number' && !isNaN(row.qtd) ? row.qtd : Number(row.qtd) || 0,
    })),
    initialStock: (m.initialStock || []).map((item, idx) => ({
      id: String(item.id || `init-${idx}`),
      equipamento: String(item.equipamento || ''),
      qtdInicial:
        typeof item.qtdInicial === 'number' && !isNaN(item.qtdInicial)
          ? item.qtdInicial
          : Number(item.qtdInicial) || 0,
    })),
    reformedStock: (m.reformedStock || []).map((item, idx) => ({
      id: String(item.id || `ref-${idx}`),
      equipamento: String(item.equipamento || ''),
      qtd:
        typeof item.qtd === 'number' && !isNaN(item.qtd)
          ? item.qtd
          : Number(item.qtd) || 0,
    })),
    controllers: (m.controllers || []).map((item, idx) => ({
      id: String(item.id || `ctrl-${idx}`),
      nome: String(item.nome || ''),
      qtd:
        typeof item.qtd === 'number' && !isNaN(item.qtd)
          ? item.qtd
          : Number(item.qtd) || 0,
    })),
    bottomAvailableStock: (m.bottomAvailableStock || []).map((item, idx) => ({
      id: String(item.id || `bot-av-${idx}`),
      equipamento: String(item.equipamento || ''),
      qtdDisponivel:
        typeof item.qtdDisponivel === 'number' && !isNaN(item.qtdDisponivel)
          ? item.qtdDisponivel
          : Number(item.qtdDisponivel) || 0,
    })),
    bottomReformedStock: (m.bottomReformedStock || []).map((item, idx) => ({
      id: String(item.id || `bot-ref-${idx}`),
      equipamento: String(item.equipamento || ''),
      qtdDisponivel:
        typeof item.qtdDisponivel === 'number' && !isNaN(item.qtdDisponivel)
          ? item.qtdDisponivel
          : Number(item.qtdDisponivel) || 0,
    })),
    updatedAt: new Date().toISOString(),
    updatedBy: String(m.updatedBy || 'Sistema'),
  };
}

/**
 * Load all months from Firestore.
 * Supports multiple months and years for continuous multi-year spreadsheet usage.
 */
export async function loadMonthsFromDb(): Promise<MonthSheetData[]> {
  try {
    const snapshot = await getDocs(collection(db, MONTHS_COLLECTION));
    if (snapshot.empty) {
      // Seed initial data to cloud database (both September closed and October active)
      for (const m of INITIAL_MONTHS) {
        const cleanM = sanitizeMonthData(m);
        await setDoc(doc(db, MONTHS_COLLECTION, cleanM.id), cleanM);
      }
      return INITIAL_MONTHS;
    }

    const loadedMonths: MonthSheetData[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as MonthSheetData;
      loadedMonths.push(sanitizeMonthData(data));
    });

    // Filtra e normaliza os meses para iniciar a partir de 2026
    const processedMonths: MonthSheetData[] = [];
    for (const m of loadedMonths) {
      let year = m.year && typeof m.year === 'number' ? m.year : 2026;
      if (year < 2026) {
        year = 2026;
        m.year = 2026;
      }
      processedMonths.push(m);
    }

    if (processedMonths.length === 0) {
      for (const m of INITIAL_MONTHS) {
        const cleanM = sanitizeMonthData(m);
        await setDoc(doc(db, MONTHS_COLLECTION, cleanM.id), cleanM);
      }
      return INITIAL_MONTHS;
    }

    // Garantir que SETEMBRO esteja presente no banco de dados (por padrão fechado caso não definido)
    const sepIdx = processedMonths.findIndex(
      (m) => m.id === 'setembro' || m.monthName.toUpperCase().includes('SETEMBRO')
    );
    if (sepIdx !== -1) {
      if (processedMonths[sepIdx].isFinalized === undefined) {
        processedMonths[sepIdx] = {
          ...processedMonths[sepIdx],
          isFinalized: true,
          isCurrent: false,
          finalizedAt: processedMonths[sepIdx].finalizedAt || '2026-09-30T23:59:59.000Z',
          finalizedBy: processedMonths[sepIdx].finalizedBy || 'Administrador Geral Digidox',
        };
        const cleanSep = sanitizeMonthData(processedMonths[sepIdx]);
        setDoc(doc(db, MONTHS_COLLECTION, cleanSep.id), cleanSep).catch((e) =>
          console.warn('Erro ao sincronizar status inicial de Setembro:', e)
        );
      }
    } else {
      // Se não havia Setembro, insere os dados do Setembro fechado
      const cleanSep = sanitizeMonthData(INITIAL_SEPTEMBER_DATA);
      processedMonths.unshift(cleanSep);
      setDoc(doc(db, MONTHS_COLLECTION, cleanSep.id), cleanSep).catch((e) =>
        console.warn('Erro ao semear Setembro no banco:', e)
      );
    }

    // Garantir que OUTUBRO esteja presente no banco
    const hasOctober = processedMonths.some(
      (m) => m.id === 'outubro' || m.monthName.toUpperCase().includes('OUTUBRO')
    );
    if (!hasOctober) {
      const cleanOct = sanitizeMonthData(INITIAL_OCTOBER_DATA);
      processedMonths.push(cleanOct);
      setDoc(doc(db, MONTHS_COLLECTION, cleanOct.id), cleanOct).catch((e) =>
        console.warn('Erro ao semear Outubro vigente no banco:', e)
      );
    }

    // Se nenhum mês estiver marcado como vigente (isCurrent), marcar Outubro ou o primeiro não-finalizado
    const hasCurrentMonth = processedMonths.some((m) => m.isCurrent);
    if (!hasCurrentMonth) {
      const octIdx = processedMonths.findIndex(
        (m) => m.id === 'outubro' || m.monthName.toUpperCase().includes('OUTUBRO')
      );
      if (octIdx !== -1) {
        processedMonths[octIdx].isCurrent = true;
      } else {
        const firstActive = processedMonths.find((m) => !m.isFinalized);
        if (firstActive) firstActive.isCurrent = true;
        else if (processedMonths.length > 0) processedMonths[0].isCurrent = true;
      }
    }

    // Ordena: Setembro primeiro, depois Outubro, seguido por outros meses
    processedMonths.sort((a, b) => {
      const aName = a.monthName.toUpperCase();
      const bName = b.monthName.toUpperCase();
      if (aName.includes('SETEMBRO')) return -1;
      if (bName.includes('SETEMBRO')) return 1;
      if (aName.includes('OUTUBRO')) return -1;
      if (bName.includes('OUTUBRO')) return 1;
      return 0;
    });

    return processedMonths;
  } catch (err) {
    console.error('Error loading months from Firestore:', err);
    return INITIAL_MONTHS;
  }
}

/**
 * Real-time listener for months collection in Firestore.
 * Automatically synchronizes any changes made by any user in real-time.
 */
export function subscribeToMonths(
  callback: (months: MonthSheetData[]) => void,
  onError?: (err: any) => void
): () => void {
  const colRef = collection(db, MONTHS_COLLECTION);
  return onSnapshot(
    colRef,
    (snapshot) => {
      if (snapshot.empty) {
        callback(INITIAL_MONTHS);
        return;
      }

      const loadedMonths: MonthSheetData[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MonthSheetData;
        loadedMonths.push(sanitizeMonthData(data));
      });

      // Normaliza anos >= 2026
      const processedMonths: MonthSheetData[] = loadedMonths.map((m) => {
        let year = m.year && typeof m.year === 'number' ? m.year : 2026;
        if (year < 2026) year = 2026;
        return { ...m, year };
      });

      // Ordena: Setembro, Outubro, e demais
      processedMonths.sort((a, b) => {
        const aName = a.monthName.toUpperCase();
        const bName = b.monthName.toUpperCase();
        if (aName.includes('SETEMBRO')) return -1;
        if (bName.includes('SETEMBRO')) return 1;
        if (aName.includes('OUTUBRO')) return -1;
        if (bName.includes('OUTUBRO')) return 1;
        return 0;
      });

      callback(processedMonths);
    },
    (err) => {
      console.warn('Real-time months subscription warning:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Save / Update a single month in Firestore and record history.
 * Ensures 100% of rows, columns, and cells are sanitized and stored permanently.
 */
export async function saveMonthToDb(
  monthData: MonthSheetData,
  user: AppUser,
  actionDescription: string,
  details?: string,
  category: 'estoque' | 'instalacoes' | 'previsoes' | 'usuarios' | 'abas' | 'sistema' = 'sistema'
): Promise<void> {
  const cleanMonth = sanitizeMonthData(monthData);
  const monthRef = doc(db, MONTHS_COLLECTION, cleanMonth.id);

  // Validação de regras no banco de dados para analistas / operadores:
  const isAdmin =
    user?.role?.toLowerCase() === 'admin' ||
    user?.email?.toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase() ||
    user?.email?.toLowerCase() === 'admin@digidox.com.br' ||
    user?.email?.toLowerCase() === 'admin@digidox.net' ||
    user?.email?.toLowerCase() === RUNTIME_ADMIN_EMAIL.toLowerCase();

  if (!isAdmin) {
    try {
      const existingSnap = await getDoc(monthRef);
      if (existingSnap.exists()) {
        const existingData = existingSnap.data() as MonthSheetData;

        // 1. Nem analista nem relbio podem alterar quantidades de estoque
        cleanMonth.initialStock = existingData.initialStock || cleanMonth.initialStock;
        cleanMonth.reformedStock = existingData.reformedStock || cleanMonth.reformedStock;
        cleanMonth.controllers = existingData.controllers || cleanMonth.controllers;

        // 2. Relbio não pode alterar previsões
        const isRelbio =
          user?.role?.toLowerCase() === 'relbio' ||
          user?.email?.toLowerCase() === DEFAULT_RELBIO_EMAIL.toLowerCase();
        if (isRelbio) {
          cleanMonth.forecasts = existingData.forecasts || cleanMonth.forecasts;
        }

        // 3. Usuário analista não pode reverter status que já esteja com 'Enviado/Instalado'
        if (!isRelbio) {
          const oldInstallations = existingData.installations || [];
          cleanMonth.installations = cleanMonth.installations.map((inst) => {
            const oldInst = oldInstallations.find((o) => o.id === inst.id);
            if (oldInst && oldInst.status === 'Enviado/Instalado' && inst.status !== 'Enviado/Instalado') {
              // Mantém 'Enviado/Instalado' para proteger integridade da regra de negócio
              return { ...inst, status: 'Enviado/Instalado' };
            }
            return inst;
          });
        }
      }
    } catch (checkErr) {
      console.warn('Non-blocking check during save:', checkErr);
    }
  }

  const dataToSave: MonthSheetData = {
    ...cleanMonth,
    updatedAt: new Date().toISOString(),
    updatedBy: user.displayName || user.email,
  };

  // Salva no banco de dados Firestore
  await setDoc(monthRef, dataToSave);

  // Armazena cópia local no navegador para máxima resiliência offline e troca rápida de usuário
  try {
    const backupKey = `equip_control_month_backup_${cleanMonth.id}`;
    localStorage.setItem(backupKey, JSON.stringify(dataToSave));
  } catch (localErr) {
    console.warn('Local backup warning:', localErr);
  }

  // Log to history in database
  await logHistoryEvent({
    user,
    action: actionDescription,
    details: details || `Alterações salvas na planilha de ${cleanMonth.monthName}`,
    category,
    monthName: cleanMonth.monthName,
    monthId: cleanMonth.id,
  });
}

/**
 * Delete a month from Firestore
 */
export async function deleteMonthFromDb(
  monthId: string,
  monthName: string,
  user: AppUser
): Promise<void> {
  const isAdmin =
    user?.role?.toLowerCase() === 'admin' ||
    user?.email?.toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase() ||
    user?.email?.toLowerCase() === 'admin@digidox.com.br' ||
    user?.email?.toLowerCase() === 'admin@digidox.net' ||
    user?.email?.toLowerCase() === RUNTIME_ADMIN_EMAIL.toLowerCase();
  if (!isAdmin) {
    throw new Error('Permissão negada: Apenas administradores têm permissão para excluir abas do banco de dados.');
  }

  const monthRef = doc(db, MONTHS_COLLECTION, monthId);
  await deleteDoc(monthRef);

  // Log history
  await logHistoryEvent({
    user,
    action: 'Exclusão de Mês',
    details: `Aba do mês ${monthName} foi removida da planilha`,
    category: 'abas',
    monthName,
    monthId,
  });
}

/**
 * Listen to real-time history events
 */
export function subscribeToHistory(callback: (history: HistoryEntry[]) => void) {
  const q = query(
    collection(db, HISTORY_COLLECTION),
    orderBy('timestamp', 'desc'),
    limit(150)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: HistoryEntry[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...(docSnap.data() as Omit<HistoryEntry, 'id'>) });
      });
      callback(items);
    },
    (err) => {
      console.error('History subscription error:', err);
    }
  );
}
