-- ============================================================
-- ASKI Flow  --  Auth Tables for SQL Server
-- Jalankan script ini pada SQL Server database Anda
-- ============================================================

-- GANTI nama database sesuai kebutuhan
USE [askiflow_db];
GO

-- ============================================================
-- TABLE: aski_users
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_users')
BEGIN
    CREATE TABLE aski_users (
        id            INT IDENTITY(1,1)  PRIMARY KEY,
        username      NVARCHAR(100)      NOT NULL  UNIQUE,
        password_hash NVARCHAR(255)      NOT NULL,
        role          NVARCHAR(20)       NOT NULL  CHECK (role IN ('admin', 'operator')),
        is_active     BIT                NOT NULL  DEFAULT 1,
        created_at    DATETIME2          NOT NULL  DEFAULT GETDATE(),
        last_login    DATETIME2          NULL
    );
    PRINT 'Table aski_users created.';
END
ELSE
    PRINT 'Table aski_users already exists (skipped).';
GO

-- ============================================================
-- TABLE: aski_operator_permissions
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_operator_permissions')
BEGIN
    CREATE TABLE aski_operator_permissions (
        id             INT IDENTITY(1,1)  PRIMARY KEY,
        permission_key NVARCHAR(100)      NOT NULL  UNIQUE,
        label          NVARCHAR(200)      NOT NULL,
        description    NVARCHAR(500)      NULL,
        is_allowed     BIT                NOT NULL  DEFAULT 0,
        updated_by     INT                NULL      REFERENCES aski_users(id),
        updated_at     DATETIME2          NOT NULL  DEFAULT GETDATE()
    );
    PRINT 'Table aski_operator_permissions created.';
END
ELSE
    PRINT 'Table aski_operator_permissions already exists (skipped).';
GO

-- ============================================================
-- Seed: Default admin user
--
-- PENTING: Ganti password sebelum deploy ke production!
-- Untuk generate bcrypt hash, jalankan perintah Python ini:
--
--   python -c "import bcrypt; h = bcrypt.hashpw(b'admin123', bcrypt.gensalt(12)); print(h.decode())"
--
-- Salin output-nya dan tempel di kolom password_hash di bawah.
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM aski_users WHERE username = 'admin')
BEGIN
    -- Hash di bawah = bcrypt('admin123', rounds=12)
    -- GANTI dengan hash baru yang Anda generate sendiri!
    INSERT INTO aski_users (username, password_hash, role)
    VALUES ('admin', '$2b$12$VO4.gbkPTVsqaLOCPEkG1OQCZaKXZlF.jNd0nB.yQcEPJhR/kZC3q', 'admin');
    PRINT 'Default admin user inserted. SEGERA ganti password!';
END
ELSE
    PRINT 'Admin user already exists (skipped).';
GO

-- ============================================================
-- Seed: Default operator permissions (semua DINONAKTIFKAN)
-- Admin dapat mengaktifkan tiap permission lewat UI Permissions.
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM aski_operator_permissions WHERE permission_key = 'canvas.edit_flow')
BEGIN
    INSERT INTO aski_operator_permissions (permission_key, label, description, is_allowed)
    VALUES
    ('canvas.edit_flow',           'Edit Canvas Flow',
     'Tambah, hapus, pindah, dan konfigurasi node pada canvas', 0),

    ('workstation.upload_data',    'Upload Data',
     'Upload file gambar dan dataset baru', 0),

    ('workstation.annotate',       'Annotasi Gambar',
     'Membuat dan mengedit anotasi bounding box pada gambar', 0),

    ('workstation.manage_datasets','Kelola Dataset',
     'Buat, rename, dan hapus dataset', 0),

    ('workstation.augment',        'Augmentasi Dataset',
     'Menjalankan job augmentasi data', 0),

    ('workstation.train',          'Training Model',
     'Memulai dan menghentikan training job', 0),

    ('workstation.manage_models',  'Kelola Model',
     'Hapus dan kelola model terlatih', 0);

    PRINT 'Default permissions inserted.';
END
ELSE
    PRINT 'Permissions already exist (skipped).';
GO

PRINT '=== ASKI Auth setup complete! ===';
GO
